import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function captureDetailContent(sourceFormat) {
  const events = [
    ["response.output_text.delta", { type: "response.output_text.delta", delta: "Hello " }],
    ["response.output_text.delta", { type: "response.output_text.delta", delta: "world" }],
    ["response.output_text.done", { type: "response.output_text.done", text: "Hello world" }],
    ["response.completed", { type: "response.completed", response: { status: "completed" } }],
  ];
  const input = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input));
      controller.close();
    },
  });
  let detailContent;
  const output = stream.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    sourceFormat,
    "codex",
    null,
    null,
    "gpt-5.6-sol",
    null,
    null,
    ({ content }) => { detailContent = content; },
  ));
  await new Response(output).text();
  return detailContent;
}

describe("Responses stream request details", () => {
  it.each([FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES])(
    "records output text for %s clients without duplicating done events",
    async (sourceFormat) => {
      expect(await captureDetailContent(sourceFormat)).toBe("Hello world");
    },
  );
});
