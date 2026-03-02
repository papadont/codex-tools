import AppKit

final class StatusViewController: NSViewController {
  private let api = LocalMemoAPI()

  private let titleLabel: NSTextField = {
    let label = NSTextField(labelWithString: "codex-memo")
    label.font = .systemFont(ofSize: 24, weight: .semibold)
    return label
  }()

  private let statusLabel: NSTextField = {
    let label = NSTextField(labelWithString: "localhost 接続確認中...")
    label.textColor = .secondaryLabelColor
    return label
  }()

  private let bodyLabel: NSTextField = {
    let label = NSTextField(labelWithString: "この app 自体は受け皿。共有メニューから text / url を codex-memo に送る。")
    label.maximumNumberOfLines = 0
    label.lineBreakMode = .byWordWrapping
    return label
  }()

  private lazy var openButton: NSButton = {
    let button = NSButton(title: "Open codex-memo", target: self, action: #selector(openMemo))
    button.bezelStyle = .rounded
    return button
  }()

  private lazy var retryButton: NSButton = {
    let button = NSButton(title: "Retry Health Check", target: self, action: #selector(retryHealthCheck))
    button.bezelStyle = .rounded
    return button
  }()

  override func loadView() {
    view = NSView()
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

    let stack = NSStackView(views: [titleLabel, statusLabel, bodyLabel, openButton, retryButton])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 14
    stack.translatesAutoresizingMaskIntoConstraints = false

    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    runHealthCheck()
  }

  @objc private func openMemo() {
    guard let url = URL(string: api.baseURL.absoluteString) else { return }
    NSWorkspace.shared.open(url)
  }

  @objc private func retryHealthCheck() {
    runHealthCheck()
  }

  private func runHealthCheck() {
    statusLabel.stringValue = "localhost 接続確認中..."
    Task { @MainActor in
      do {
        let ok = try await api.healthCheck()
        statusLabel.stringValue = ok
          ? "接続OK: Share Extension から保存できる状態"
          : "接続NG: codex-memo が起動してないかも"
      } catch {
        statusLabel.stringValue = "接続エラー: \(error.localizedDescription)"
      }
    }
  }
}
