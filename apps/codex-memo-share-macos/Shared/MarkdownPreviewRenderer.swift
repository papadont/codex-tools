import AppKit
import Foundation

enum MarkdownPreviewRenderer {
  static func loadMarkdown(from url: URL) throws -> String {
    let data = try Data(contentsOf: url)
    if let text = String(data: data, encoding: .utf8) { return text }
    if let text = String(data: data, encoding: .unicode) { return text }
    if let text = String(data: data, encoding: .utf16LittleEndian) { return text }
    if let text = String(data: data, encoding: .utf16BigEndian) { return text }
    return String(decoding: data, as: UTF8.self)
  }

  static func makeAttributedString(markdown: String) -> NSAttributedString {
    let output = NSMutableAttributedString()
    let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n")
    let lines = normalized.components(separatedBy: "\n")

    var inCodeBlock = false
    var codeLines: [String] = []

    for line in lines {
      if line.hasPrefix("```") {
        if inCodeBlock {
          appendCodeBlock(codeLines.joined(separator: "\n"), to: output)
          codeLines.removeAll()
          inCodeBlock = false
        } else {
          inCodeBlock = true
        }
        continue
      }

      if inCodeBlock {
        codeLines.append(line)
        continue
      }

      if line.trimmingCharacters(in: .whitespaces).isEmpty {
        output.append(NSAttributedString(string: "\n"))
        continue
      }

      if let heading = headingLevel(for: line) {
        appendHeading(String(line.dropFirst(heading).trimmingCharacters(in: .whitespaces)), level: heading, to: output)
        continue
      }

      if line.hasPrefix(">") {
        appendQuote(String(line.dropFirst().trimmingCharacters(in: .whitespaces)), to: output)
        continue
      }

      if let bullet = bulletPrefix(for: line) {
        appendListItem(text: String(line.dropFirst(bullet).trimmingCharacters(in: .whitespaces)), to: output)
        continue
      }

      appendBody(line, to: output)
    }

    if !codeLines.isEmpty {
      appendCodeBlock(codeLines.joined(separator: "\n"), to: output)
    }

    linkify(in: output)
    return output
  }

  private static func headingLevel(for line: String) -> Int? {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("### ") { return 3 }
    if trimmed.hasPrefix("## ") { return 2 }
    if trimmed.hasPrefix("# ") { return 1 }
    return nil
  }

  private static func bulletPrefix(for line: String) -> Int? {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") { return 2 }
    return nil
  }

  private static func appendHeading(_ text: String, level: Int, to output: NSMutableAttributedString) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    paragraph.paragraphSpacing = level == 1 ? 14 : 10
    paragraph.paragraphSpacingBefore = level == 1 ? 6 : 4
    if level == 2 {
      paragraph.headIndent = 10
      paragraph.firstLineHeadIndent = 10
    }

    let font: NSFont
    let color: NSColor
    switch level {
    case 1:
      font = NSFont.boldSystemFont(ofSize: 24)
      color = NSColor(calibratedRed: 0.29, green: 0.33, blue: 0.41, alpha: 1)
    case 2:
      font = NSFont.boldSystemFont(ofSize: 18)
      color = NSColor(calibratedRed: 0.38, green: 0.37, blue: 0.35, alpha: 1)
    default:
      font = NSFont.boldSystemFont(ofSize: 16)
      color = NSColor(calibratedRed: 0.39, green: 0.42, blue: 0.47, alpha: 1)
    }

    output.append(NSAttributedString(
      string: text + "\n",
      attributes: [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph
      ]
    ))
  }

  private static func appendBody(_ text: String, to output: NSMutableAttributedString) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 5
    paragraph.paragraphSpacing = 8
    output.append(makeInlineStyledString(text + "\n", baseFont: NSFont.systemFont(ofSize: 15), textColor: bodyColor, paragraph: paragraph))
  }

  private static func appendListItem(text: String, to output: NSMutableAttributedString) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    paragraph.paragraphSpacing = 5
    paragraph.headIndent = 20
    paragraph.firstLineHeadIndent = 0
    let bulletText = "• " + text + "\n"
    output.append(makeInlineStyledString(bulletText, baseFont: NSFont.systemFont(ofSize: 15), textColor: bodyColor, paragraph: paragraph))
  }

  private static func appendQuote(_ text: String, to output: NSMutableAttributedString) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 5
    paragraph.paragraphSpacing = 8
    paragraph.paragraphSpacingBefore = 3
    paragraph.headIndent = 18
    paragraph.firstLineHeadIndent = 18
    let quoteText = "▍ " + text + "\n"
    output.append(makeInlineStyledString(
      quoteText,
      baseFont: NSFont.systemFont(ofSize: 15),
      textColor: NSColor(calibratedRed: 0.37, green: 0.35, blue: 0.31, alpha: 1),
      paragraph: paragraph,
      backgroundColor: NSColor(calibratedRed: 0.95, green: 0.95, blue: 0.92, alpha: 1)
    ))
  }

  private static func appendCodeBlock(_ text: String, to output: NSMutableAttributedString) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    paragraph.paragraphSpacing = 10
    paragraph.paragraphSpacingBefore = 4
    paragraph.headIndent = 14
    paragraph.firstLineHeadIndent = 14
    let block = text.isEmpty ? " " : text
    output.append(NSAttributedString(
      string: block + "\n\n",
      attributes: [
        .font: NSFont.monospacedSystemFont(ofSize: 14, weight: .regular),
        .foregroundColor: NSColor(calibratedRed: 0.97, green: 0.96, blue: 0.94, alpha: 1),
        .backgroundColor: NSColor(calibratedRed: 0.40, green: 0.43, blue: 0.47, alpha: 1),
        .paragraphStyle: paragraph
      ]
    ))
  }

  private static func makeInlineStyledString(
    _ text: String,
    baseFont: NSFont,
    textColor: NSColor,
    paragraph: NSParagraphStyle,
    backgroundColor: NSColor? = nil
  ) -> NSAttributedString {
    let output = NSMutableAttributedString(string: text, attributes: [
      .font: baseFont,
      .foregroundColor: textColor,
      .paragraphStyle: paragraph
    ])

    if let backgroundColor {
      output.addAttribute(.backgroundColor, value: backgroundColor, range: NSRange(location: 0, length: output.length))
    }

    let full = output.string as NSString
    let inlineCode = try? NSRegularExpression(pattern: "`([^`]+)`")
    inlineCode?.matches(in: output.string, range: NSRange(location: 0, length: full.length)).reversed().forEach { match in
      let contentRange = match.range(at: 1)
      let inner = full.substring(with: contentRange)
      output.replaceCharacters(in: match.range, with: NSAttributedString(
        string: inner,
        attributes: [
          .font: NSFont.monospacedSystemFont(ofSize: max(baseFont.pointSize - 1, 13), weight: .regular),
          .foregroundColor: NSColor(calibratedRed: 0.97, green: 0.96, blue: 0.94, alpha: 1),
          .backgroundColor: NSColor(calibratedRed: 0.40, green: 0.43, blue: 0.47, alpha: 1),
          .paragraphStyle: paragraph
        ]
      ))
    }

    let bold = try? NSRegularExpression(pattern: "\\*\\*([^*]+)\\*\\*")
    bold?.matches(in: output.string, range: NSRange(location: 0, length: output.length)).reversed().forEach { match in
      let contentRange = match.range(at: 1)
      let inner = (output.string as NSString).substring(with: contentRange)
      output.replaceCharacters(in: match.range, with: NSAttributedString(
        string: inner,
        attributes: [
          .font: NSFont.boldSystemFont(ofSize: baseFont.pointSize),
          .foregroundColor: textColor,
          .paragraphStyle: paragraph
        ]
      ))
    }

    return output
  }

  private static func linkify(in output: NSMutableAttributedString) {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
      return
    }
    let fullRange = NSRange(location: 0, length: output.length)
    detector.matches(in: output.string, options: [], range: fullRange).forEach { match in
      guard let url = match.url else { return }
      output.addAttributes([
        .link: url,
        .foregroundColor: NSColor.systemBlue,
        .underlineStyle: NSUnderlineStyle.single.rawValue
      ], range: match.range)
    }
  }

  private static let bodyColor = NSColor(calibratedRed: 0.29, green: 0.33, blue: 0.41, alpha: 1)
}
