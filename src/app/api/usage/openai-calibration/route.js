import { NextResponse } from "next/server";
import {
  getOpenAICreditsByConnection,
  getProviderConnectionById,
  getProviderConnections,
  getSettings,
  updateSettings,
} from "@/lib/localDb";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import {
  calculateCalibrationSample,
  getCalibratedWeeklyCredits,
} from "@/shared/utils/openaiSubscriptionUsage.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getWeeklyQuota(usage) {
  const weekly = usage?.quotas?.weekly;
  if (!weekly || !Number.isFinite(Number(weekly.used)) || !weekly.resetAt) {
    throw new Error("OpenAI 当前没有返回可校准的周用量窗口");
  }
  return weekly;
}

function getWindowStart(quota) {
  const resetAt = new Date(quota.resetAt).getTime();
  const seconds = Number(quota.windowSeconds) || 604800;
  if (!Number.isFinite(resetAt)) throw new Error("OpenAI 返回了无效的周用量重置时间");
  return new Date(resetAt - seconds * 1000).toISOString();
}

async function readAccountState(connection, calibration) {
  const usage = await getCodexUsage(
    connection.accessToken,
    connection.proxyOptions || null,
    connection.providerSpecificData || null,
  );
  const weekly = getWeeklyQuota(usage);
  const weeklyCredits = getCalibratedWeeklyCredits(calibration);
  const localWeekCredits = await getOpenAICreditsByConnection(
    connection.id,
    getWindowStart(weekly),
  );
  const trackedPercent = weeklyCredits ? localWeekCredits / weeklyCredits * 100 : null;
  return {
    connectionId: connection.id,
    accountName: connection.name || connection.email || connection.id,
    plan: usage.plan,
    officialUsedPercent: Number(weekly.used),
    officialRemainingPercent: Number(weekly.remaining),
    resetAt: weekly.resetAt,
    windowSeconds: weekly.windowSeconds || 604800,
    localWeekCredits,
    trackedPercent,
    unassignedPercent: trackedPercent == null ? null : Number(weekly.used) - trackedPercent,
    calibration: calibration || { samples: [] },
    effectiveWeeklyCredits: weeklyCredits,
  };
}

async function getResponsePayload() {
  const [connections, settings] = await Promise.all([
    getProviderConnections(),
    getSettings(),
  ]);
  const calibrations = settings.openaiUsageCalibrations || {};
  const codexConnections = connections.filter((connection) =>
    connection.provider === "codex" && connection.isActive !== false && connection.accessToken
  );
  const results = await Promise.allSettled(codexConnections.map((connection) =>
    readAccountState(connection, calibrations[connection.id])
  ));
  return {
    calibrations,
    accounts: results.map((result, index) => result.status === "fulfilled"
      ? result.value
      : {
          connectionId: codexConnections[index].id,
          accountName: codexConnections[index].name || codexConnections[index].email || codexConnections[index].id,
          error: result.reason?.message || "读取 OpenAI 周用量失败",
          calibration: calibrations[codexConnections[index].id] || { samples: [] },
        }),
  };
}

export async function GET() {
  try {
    return NextResponse.json(await getResponsePayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = String(body?.action || "");
    const connectionId = String(body?.connectionId || "");
    if (!connectionId) return NextResponse.json({ error: "缺少 OpenAI 账号" }, { status: 400 });

    const connection = await getProviderConnectionById(connectionId);
    if (!connection || connection.provider !== "codex" || !connection.accessToken) {
      return NextResponse.json({ error: "找不到可用的 OpenAI Codex 账号" }, { status: 404 });
    }

    const settings = await getSettings();
    const calibrations = { ...(settings.openaiUsageCalibrations || {}) };
    const current = calibrations[connectionId] || { samples: [] };

    if (action === "cancel") {
      calibrations[connectionId] = { ...current, baseline: null };
      await updateSettings({ openaiUsageCalibrations: calibrations });
      return NextResponse.json(await getResponsePayload());
    }

    if (action === "start") {
      const displayed = body?.snapshot;
      const usedPercent = Number(displayed?.usedPercent);
      const resetAt = new Date(displayed?.resetAt || "");
      if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 || !Number.isFinite(resetAt.getTime())) {
        return NextResponse.json({ error: "页面上的 OpenAI 周用量快照无效，请先刷新官方用量" }, { status: 400 });
      }
      const localCredits = await getOpenAICreditsByConnection(connectionId);
      const snapshot = {
        usedPercent,
        localCredits,
        resetAt: resetAt.toISOString(),
        capturedAt: new Date().toISOString(),
      };
      calibrations[connectionId] = { ...current, baseline: snapshot };
      await updateSettings({ openaiUsageCalibrations: calibrations });
      return NextResponse.json({ calibrations });
    }

    if (action === "complete") {
      if (!current.baseline) {
        return NextResponse.json({ error: "请先开始一次校准" }, { status: 409 });
      }
      const usage = await getCodexUsage(
        connection.accessToken,
        connection.proxyOptions || null,
        connection.providerSpecificData || null,
      );
      const weekly = getWeeklyQuota(usage);
      const localCredits = await getOpenAICreditsByConnection(connectionId);
      const snapshot = {
        usedPercent: Number(weekly.used),
        localCredits,
        resetAt: weekly.resetAt,
        capturedAt: new Date().toISOString(),
      };
      if (current.baseline.resetAt !== snapshot.resetAt) {
        return NextResponse.json({ error: "OpenAI 周窗口已经重置，请重新开始校准" }, { status: 409 });
      }
      const sample = calculateCalibrationSample(current.baseline, snapshot);
      calibrations[connectionId] = {
        samples: [...(current.samples || []), {
          ...sample,
          startedAt: current.baseline.capturedAt,
          completedAt: snapshot.capturedAt,
          resetAt: snapshot.resetAt,
        }].slice(-20),
        baseline: null,
      };
      await updateSettings({ openaiUsageCalibrations: calibrations });
      return NextResponse.json(await getResponsePayload());
    }

    return NextResponse.json({ error: "不支持的校准操作" }, { status: 400 });
  } catch (error) {
    const status = error instanceof RangeError ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
