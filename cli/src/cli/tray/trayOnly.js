const path = require("path");
const { execFile } = require("child_process");
const { initWinTray } = require("./trayWin");

if (process.platform !== "win32") {
  throw new Error("The standalone tray icon is only available on Windows");
}

const port = Number(process.env.PORT || 20128);
const tray = initWinTray({
  iconPath: path.join(__dirname, "icon.ico"),
  tooltip: `9Router - Port ${port}`,
  items: [
    { title: `9Router (Port ${port})`, enabled: false },
    { title: "Open Dashboard", enabled: true },
    { title: "Exit tray icon", enabled: true }
  ],
  onClick(index) {
    if (index === 1) {
      execFile("rundll32.exe", ["url.dll,FileProtocolHandler", `http://localhost:${port}/dashboard`], (error) => {
        if (error) console.error("Failed to open 9Router dashboard:", error);
      });
    } else if (index === 2) {
      tray.kill();
      setTimeout(() => process.exit(0), 500);
    }
  }
});

if (!tray) {
  throw new Error("Failed to create 9Router tray icon");
}
