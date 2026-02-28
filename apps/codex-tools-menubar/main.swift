import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private var hushProcess: Process?
  private var memoProcess: Process?
  private var codexResetStatusItem: NSMenuItem!
  private var memoModeStatusItem: NSMenuItem!
  private var statusTimer: Timer?
  private var currentMemoLaunchMode = "mixed"

  private let homeDir = NSHomeDirectory()
  private lazy var hushDir = "\(homeDir)/Documents/develop/hush-pointer"
  private lazy var codexToolsDir = "\(homeDir)/Documents/develop/codex-tools"
  private lazy var credentialsPath = ProcessInfo.processInfo.environment["GOOGLE_APPLICATION_CREDENTIALS"]
    ?? "\(homeDir)/.config/gcp/codex-tools-firestore-sa.json"
  private let hushLogPath = "/tmp/hush-pointer-dev.log"
  private let memoLogPath = "/tmp/codex-memo-web.log"
  private lazy var usageLatestPath = "\(codexToolsDir)/dist/usage-reports/weekly/latest.json"

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    setupMenuBar()
    restartBoth()
    startStatusPolling()
    updateStatusItems()
  }

  func applicationWillTerminate(_ notification: Notification) {
    statusTimer?.invalidate()
    stopBoth()
  }

  private func setupMenuBar() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem.button?.title = "[p/m]"

    let menu = NSMenu()
    codexResetStatusItem = NSMenuItem(title: "codex 1w reset: checking...", action: nil, keyEquivalent: "")
    codexResetStatusItem.isEnabled = false
    menu.addItem(codexResetStatusItem)
    memoModeStatusItem = NSMenuItem(title: "memo mode: mixed", action: nil, keyEquivalent: "")
    memoModeStatusItem.isEnabled = false
    menu.addItem(memoModeStatusItem)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "Open hush log", action: #selector(openHushLogAction), keyEquivalent: "1"))
    menu.addItem(NSMenuItem(title: "Open memo log", action: #selector(openMemoLogAction), keyEquivalent: "2"))
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "Restart Both", action: #selector(restartBothAction), keyEquivalent: "r"))
    menu.addItem(NSMenuItem(title: "Restart hush-pointer", action: #selector(restartHushAction), keyEquivalent: "h"))
    menu.addItem(NSMenuItem(title: "Restart codex-memo (Mixed)", action: #selector(restartMemoMixedAction), keyEquivalent: "m"))
    menu.addItem(NSMenuItem(title: "Restart codex-memo (iCloud)", action: #selector(restartMemoICloudAction), keyEquivalent: "i"))
    menu.addItem(NSMenuItem(title: "Restart codex-memo (Firestore)", action: #selector(restartMemoFirestoreAction), keyEquivalent: "f"))
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "Stop Both", action: #selector(stopBothAction), keyEquivalent: "s"))
    menu.addItem(NSMenuItem(title: "Stop hush-pointer", action: #selector(stopHushAction), keyEquivalent: "x"))
    menu.addItem(NSMenuItem(title: "Stop codex-memo", action: #selector(stopMemoAction), keyEquivalent: "c"))
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "Open Both in Browser", action: #selector(openBothInBrowserAction), keyEquivalent: "o"))
    menu.addItem(NSMenuItem(title: "Open hush in Browser", action: #selector(openHushInBrowserAction), keyEquivalent: "u"))
    menu.addItem(NSMenuItem(title: "Open memo in Browser", action: #selector(openMemoInBrowserAction), keyEquivalent: "i"))
    menu.addItem(NSMenuItem.separator())
    menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitAction), keyEquivalent: "q"))

    for item in menu.items where item.action != nil {
      item.target = self
    }

    statusItem.menu = menu
  }

  @objc private func restartBothAction() { restartBoth() }
  @objc private func restartHushAction() { restartHush() }
  @objc private func restartMemoMixedAction() { restartMemo(mode: "mixed") }
  @objc private func restartMemoICloudAction() { restartMemo(mode: "icloud") }
  @objc private func restartMemoFirestoreAction() { restartMemo(mode: "firebase") }
  @objc private func stopBothAction() {
    stopBoth()
    updateStatusItems()
  }
  @objc private func stopHushAction() {
    stopHush()
    updateStatusItems()
  }
  @objc private func stopMemoAction() {
    stopMemo()
    updateStatusItems()
  }

  @objc private func openHushLogAction() {
    ensureFileExists(at: hushLogPath)
    NSWorkspace.shared.open(URL(fileURLWithPath: hushLogPath))
  }

  @objc private func openMemoLogAction() {
    ensureFileExists(at: memoLogPath)
    NSWorkspace.shared.open(URL(fileURLWithPath: memoLogPath))
  }

  @objc private func quitAction() {
    stopBoth()
    NSApp.terminate(nil)
  }

  @objc private func openBothInBrowserAction() {
    openHushInBrowserAction()
    openMemoInBrowserAction()
  }

  @objc private func openHushInBrowserAction() {
    if let url = URL(string: "http://localhost:5173") {
      NSWorkspace.shared.open(url)
    }
  }

  @objc private func openMemoInBrowserAction() {
    if let url = URL(string: "http://localhost:4173") {
      NSWorkspace.shared.open(url)
    }
  }

  private func restartBoth() {
    restartHush()
    restartMemo(mode: "mixed")
    updateStatusItems()
  }

  private func restartHush() {
    runShell("pkill -f \(shellQuote("\(regexEscape(hushDir)).*npm run dev")) || true")
    runShell("pkill -f \(shellQuote("\(regexEscape(hushDir)).*vite")) || true")
    hushProcess?.terminate()
    hushProcess = launchShell("cd \(shellQuote(hushDir)) && npm run dev >> \(shellQuote(hushLogPath)) 2>&1")
    updateStatusItems()
  }

  private func restartMemo(mode: String) {
    runShell("pkill -f 'node .*scripts/codex_memo_web_server\\.js' || true")
    runShell("pkill -f \(shellQuote("\(regexEscape(codexToolsDir)).*npm run memo:web")) || true")
    memoProcess?.terminate()
    currentMemoLaunchMode = mode
    let memoCommand = memoLaunchCommand(for: mode)
    memoProcess = launchShell("export GOOGLE_APPLICATION_CREDENTIALS=\(shellQuote(credentialsPath)); cd \(shellQuote(codexToolsDir)) && \(memoCommand) >> \(shellQuote(memoLogPath)) 2>&1")
    updateStatusItems()
  }

  private func memoLaunchCommand(for mode: String) -> String {
    switch mode {
    case "icloud":
      return "npm run memo:web:icloud"
    case "firebase":
      return "npm run memo:web:firebase"
    default:
      return "npm run memo:web"
    }
  }

  private func stopBoth() {
    stopHush()
    stopMemo()
    updateStatusItems()
  }

  private func stopHush() {
    runShell("pkill -f \(shellQuote("\(regexEscape(hushDir)).*npm run dev")) || true")
    runShell("pkill -f \(shellQuote("\(regexEscape(hushDir)).*vite")) || true")
    hushProcess?.terminate()
    hushProcess = nil
    updateStatusItems()
  }

  private func stopMemo() {
    runShell("pkill -f 'node .*scripts/codex_memo_web_server\\.js' || true")
    runShell("pkill -f \(shellQuote("\(regexEscape(codexToolsDir)).*npm run memo:web")) || true")
    memoProcess?.terminate()
    memoProcess = nil
    updateStatusItems()
  }

  private func launchShell(_ command: String) -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", command]
    try? process.run()
    return process
  }

  private func runShell(_ command: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", command]
    try? process.run()
    process.waitUntilExit()
  }

  private func startStatusPolling() {
    statusTimer?.invalidate()
    statusTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
      self?.updateStatusItems()
    }
  }

  private func updateStatusItems() {
    let hushRunning = isHushRunning()
    let memoRunning = isMemoRunning()
    memoModeStatusItem?.title = "memo mode: \(displayMemoMode(currentMemoLaunchMode))"
    codexResetStatusItem?.title = "codex 1w reset: \(readCodexWeeklyResetText())"

    let pChar = hushRunning ? "P" : "p"
    let mChar = memoRunning ? "M" : "m"
    statusItem.button?.title = "\(pChar)/\(mChar)"
  }

  private func displayMemoMode(_ mode: String) -> String {
    switch mode {
    case "icloud":
      return "iCloud"
    case "firebase":
      return "Firestore"
    default:
      return "Mixed"
    }
  }

  private func readCodexWeeklyResetText() -> String {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: usageLatestPath)),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let codexUsage = json["codexUsage"] as? [String: Any],
          let secondaryWindow = codexUsage["secondaryWindow"] as? [String: Any],
          let resetAtISO = secondaryWindow["resetAtISO"] as? String else {
      return "-"
    }
    return formatDate(rolledWeeklyISO(resetAtISO))
  }

  private func rolledWeeklyISO(_ value: String) -> String {
    let inFormatter = ISO8601DateFormatter()
    inFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let parsed = inFormatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    guard var date = parsed else { return value }
    let now = Date()
    while date <= now {
      date = date.addingTimeInterval(7 * 24 * 60 * 60)
    }
    return ISO8601DateFormatter().string(from: date)
  }

  private func formatDate(_ value: String) -> String {
    let inFormatter = ISO8601DateFormatter()
    inFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let parsed = inFormatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    guard let date = parsed else { return value }
    let outFormatter = DateFormatter()
    outFormatter.dateFormat = "yyyy/MM/dd HH:mm:ss"
    return outFormatter.string(from: date)
  }

  private func isHushRunning() -> Bool {
    return pgrep(pattern: "\(regexEscape(hushDir)).*npm run dev")
      || pgrep(pattern: "\(regexEscape(hushDir)).*vite")
  }

  private func isMemoRunning() -> Bool {
    return pgrep(pattern: "node .*scripts/codex_memo_web_server\\.js")
      || pgrep(pattern: "\(regexEscape(codexToolsDir)).*npm run memo:web")
  }

  private func shellQuote(_ value: String) -> String {
    return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  private func regexEscape(_ value: String) -> String {
    return NSRegularExpression.escapedPattern(for: value)
  }

  private func pgrep(pattern: String) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    process.arguments = ["-f", pattern]
    do {
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus == 0
    } catch {
      return false
    }
  }

  private func ensureFileExists(at path: String) {
    if !FileManager.default.fileExists(atPath: path) {
      FileManager.default.createFile(atPath: path, contents: Data(), attributes: nil)
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
