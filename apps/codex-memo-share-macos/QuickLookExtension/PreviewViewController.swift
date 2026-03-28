import AppKit
import Quartz

@objc(PreviewViewController)
final class PreviewViewController: NSViewController, QLPreviewingController {
  private let scrollView = NSScrollView()
  private let textView = NSTextView()

  override func loadView() {
    let container = NSView()
    container.wantsLayer = true
    container.layer?.backgroundColor = NSColor(calibratedRed: 0.98, green: 0.97, blue: 0.95, alpha: 1).cgColor

    scrollView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.drawsBackground = false
    scrollView.borderType = .noBorder
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = false
    scrollView.automaticallyAdjustsContentInsets = false

    textView.isEditable = false
    textView.isSelectable = true
    textView.drawsBackground = true
    textView.backgroundColor = NSColor(calibratedRed: 0.996, green: 0.992, blue: 0.984, alpha: 1)
    textView.textContainerInset = NSSize(width: 28, height: 24)
    textView.textContainer?.widthTracksTextView = true
    textView.textContainer?.heightTracksTextView = false
    textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    textView.minSize = NSSize(width: 0, height: 0)
    textView.autoresizingMask = [.width]
    textView.linkTextAttributes = [
      .foregroundColor: NSColor.systemBlue,
      .underlineStyle: NSUnderlineStyle.single.rawValue
    ]
    scrollView.documentView = textView

    container.addSubview(scrollView)
    NSLayoutConstraint.activate([
      scrollView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      scrollView.topAnchor.constraint(equalTo: container.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
    ])

    view = container
  }

  func preparePreviewOfFile(at url: URL) async throws {
    let markdown = try MarkdownPreviewRenderer.loadMarkdown(from: url)
    title = url.lastPathComponent
    textView.textStorage?.setAttributedString(MarkdownPreviewRenderer.makeAttributedString(markdown: markdown))
  }
}
