import AppKit
import Foundation
import ImageIO
import Social
import UniformTypeIdentifiers

@objc(ShareViewController)
final class ShareViewController: SLComposeServiceViewController {
  private let api = LocalMemoAPI()
  private let webpageTypeIdentifier = "public.active-webpage"
  private let debugLogURL = FileManager.default.temporaryDirectory.appendingPathComponent("codex-memo-share-extension.log")
  private let ignoredFileTypeIdentifiers = [
    UTType.url.identifier,
    UTType.fileURL.identifier,
    UTType.plainText.identifier,
    "public.active-webpage"
  ]
  private var cachedSharedPayload: SharedPayload?
  private var sharedPayloadTask: Task<SharedPayload, Error>?

  private let canvasColor = NSColor(srgbRed: 0.95, green: 0.96, blue: 0.97, alpha: 1)
  private let cardColor = NSColor.white
  private let accentColor = NSColor(srgbRed: 0.16, green: 0.31, blue: 0.32, alpha: 1)

  private struct SharedPayload {
    var lines: [String] = []
    var attachments: [MemoAttachment] = []
    var attachmentReferences: [String] = []
  }

  private struct FileRepresentation {
    let copiedURL: URL
    let sourceURL: URL
  }

  private struct ResolvedFilePayload {
    let data: Data
    let fileName: String?
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "codex-memo"
  }

  override func viewDidAppear() {
    super.viewDidAppear()
    view.window?.title = "codex-memo"
    applyTheme()
    makePostButtonDefaultIfPossible()
  }

  override func isContentValid() -> Bool {
    if !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return true
    }
    return extensionItems().isEmpty == false
  }

  override func didSelectPost() {
    Task {
      do {
        appendDebugLog("didSelectPost:start")
        let draft = try await buildDraft()
        appendDebugLog("didSelectPost:draft bodyLength=\(draft.memoBody.count) attachments=\(draft.attachments.count)")
        _ = try await api.save(draft: draft)
        appendDebugLog("didSelectPost:save success")
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
      } catch {
        appendDebugLog("didSelectPost:error \(String(describing: error))")
        extensionContext?.cancelRequest(withError: error)
      }
    }
  }

  private func buildDraft() async throws -> MemoDraft {
    let userComment = contentText.trimmingCharacters(in: .whitespacesAndNewlines)
    let sharedPayload = try await sharedPayload()
    let body = MemoDraft.composeBody(sections: [
      userComment,
      sharedPayload.lines.joined(separator: "\n"),
      sharedPayload.attachmentReferences.joined(separator: "\n")
    ].filter { !$0.isEmpty })
    let titleSource = MemoDraft.composeBody(sections: [
      userComment,
      sharedPayload.lines.joined(separator: "\n")
    ].filter { !$0.isEmpty })
    let title = MemoDraft.makeTitle(from: titleSource, fallback: "Shared from macOS")
    return MemoDraft(
      projectName: "share",
      memoType: "memo",
      threadTitle: title,
      memoBody: body,
      attachments: sharedPayload.attachments,
      createdBy: "codex-memo-share-extension",
      sourceThread: "macOS Share Extension"
    )
  }

  private func sharedPayload() async throws -> SharedPayload {
    if let cachedSharedPayload {
      return cachedSharedPayload
    }
    if let sharedPayloadTask {
      return try await sharedPayloadTask.value
    }

    let task = Task { try await collectSharedPayload() }
    sharedPayloadTask = task
    do {
      let payload = try await task.value
      cachedSharedPayload = payload
      sharedPayloadTask = nil
      return payload
    } catch {
      sharedPayloadTask = nil
      throw error
    }
  }

  private func applyTheme() {
    view.wantsLayer = true
    view.layer?.backgroundColor = canvasColor.cgColor

    for textView in findEditableTextViews(in: view) {
      textView.drawsBackground = true
      textView.backgroundColor = cardColor
      textView.textColor = accentColor
      textView.insertionPointColor = accentColor
      textView.focusRingType = .none
      if let scrollView = textView.enclosingScrollView {
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.focusRingType = .none
      }
    }
  }

  private func makePostButtonDefaultIfPossible() {
    guard let postButton = findPostButton(in: view) else {
      return
    }
    postButton.keyEquivalent = "\r"
    postButton.keyEquivalentModifierMask = []
    postButton.bezelStyle = .rounded
    postButton.wantsLayer = true
    postButton.contentTintColor = .white
    postButton.attributedTitle = NSAttributedString(
      string: postButton.title,
      attributes: [
        .foregroundColor: NSColor.white,
        .font: postButton.font ?? NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
      ]
    )
    postButton.layer?.backgroundColor = accentColor.cgColor
    postButton.layer?.cornerRadius = 10
    postButton.layer?.borderWidth = 0
    postButton.needsDisplay = true
    view.window?.defaultButtonCell = postButton.cell as? NSButtonCell
  }

  private func findEditableTextViews(in rootView: NSView) -> [NSTextView] {
    var result: [NSTextView] = []

    if let textView = rootView as? NSTextView, textView.isEditable {
      result.append(textView)
    }

    for subview in rootView.subviews {
      result.append(contentsOf: findEditableTextViews(in: subview))
    }

    return result
  }

  private func findPostButton(in rootView: NSView) -> NSButton? {
    if let button = rootView as? NSButton,
       ["Post", "投稿", "送信"].contains(button.title) {
      return button
    }
    for subview in rootView.subviews {
      if let button = findPostButton(in: subview) {
        return button
      }
    }
    return nil
  }

  private func extensionItems() -> [NSExtensionItem] {
    (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
  }

  private func collectSharedPayload() async throws -> SharedPayload {
    var payload = SharedPayload()
    for item in extensionItems() {
      for provider in item.attachments ?? [] {
        appendDebugLog("provider types=\(provider.registeredTypeIdentifiers.joined(separator: ",")) suggestedName=\(provider.suggestedName ?? "-")")
        if let imageAttachment = try await loadImageAttachment(from: provider) {
          payload.attachments.append(imageAttachment)
          payload.attachmentReferences.append("![\(imageAttachment.caption)](attachment://\(imageAttachment.id))")
          continue
        }

        if let fileAttachment = try await loadFileAttachment(from: provider) {
          payload.attachments.append(fileAttachment)
          payload.attachmentReferences.append("[\(fileAttachment.caption)](attachment://\(fileAttachment.id))")
          continue
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          if let text = try await loadString(from: provider, typeIdentifier: UTType.plainText.identifier) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
              payload.lines.append("Text:")
              payload.lines.append(trimmed)
            }
          }
          continue
        }

        if let urlString = try await loadSharedURLString(from: provider) {
          if isFileSchemeURLString(urlString) {
            if let fileLine = try await loadFileSummaryLine(from: provider, fallbackURLString: urlString),
               payload.lines.contains(fileLine) == false {
              payload.lines.append(fileLine)
            }
          } else if payload.lines.contains("URL: \(urlString)") == false {
            payload.lines.append("URL: \(urlString)")
          }
          continue
        }

        if let fileLine = try await loadFileSummaryLine(from: provider) {
          if payload.lines.contains(fileLine) == false {
            payload.lines.append(fileLine)
          }
        }
      }
    }
    return payload
  }

  private func loadString(from provider: NSItemProvider, typeIdentifier: String) async throws -> String? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        if let text = item as? String {
          continuation.resume(returning: text)
          return
        }
        if let attributed = item as? NSAttributedString {
          continuation.resume(returning: attributed.string)
          return
        }
        continuation.resume(returning: nil)
      }
    }
  }

  private func loadSharedURLString(from provider: NSItemProvider) async throws -> String? {
    let supportedIdentifiers = [
      UTType.url.identifier,
      webpageTypeIdentifier
    ]

    for typeIdentifier in supportedIdentifiers where provider.hasItemConformingToTypeIdentifier(typeIdentifier) {
      if let value = try await loadURLLikeValue(from: provider, typeIdentifier: typeIdentifier) {
        return value
      }
    }

    return nil
  }

  private func loadFileSummaryLine(
    from provider: NSItemProvider,
    fallbackURLString: String? = nil
  ) async throws -> String? {
    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
       let fileRepresentation = try await loadFileRepresentation(from: provider, typeIdentifier: UTType.fileURL.identifier) {
      let fileName = preferredFileName(
        from: provider,
        candidateNames: [fileRepresentation.sourceURL.lastPathComponent],
        fallbackBaseName: "shared-file",
        fallbackExtension: fileRepresentation.sourceURL.pathExtension
      )
      if isImageURL(fileRepresentation.sourceURL) {
        return nil
      }
      return "File: \(fileName)"
    }

    guard let fallbackURLString, isFileSchemeURLString(fallbackURLString) else {
      return nil
    }
    let parsedURL = URL(string: fallbackURLString)
    let fallbackExtension = parsedURL?.pathExtension ?? ""
    let fileName = preferredFileName(
      from: provider,
      candidateNames: [parsedURL?.lastPathComponent].compactMap { $0 },
      fallbackBaseName: "shared-file",
      fallbackExtension: fallbackExtension
    )
    return "File: \(fileName)"
  }

  private func loadImageAttachment(from provider: NSItemProvider) async throws -> MemoAttachment? {
    if let imageTypeIdentifier = provider.registeredTypeIdentifiers.first(where: {
      UTType(importedAs: $0).conforms(to: .image)
    }) {
      if let data = try await loadDataRepresentation(from: provider, typeIdentifier: imageTypeIdentifier) {
        return makeImageAttachment(
          data: data,
          fileName: preferredFileName(
            from: provider,
            candidateNames: [],
            fallbackBaseName: "shared-image",
            fallbackExtension: fileExtension(for: imageTypeIdentifier) ?? "png"
          ),
          mimeType: preferredMimeType(for: imageTypeIdentifier, fallbackExtension: "png")
        )
      }

      if let fileRepresentation = try await loadFileRepresentation(from: provider, typeIdentifier: imageTypeIdentifier),
         let data = try? Data(contentsOf: fileRepresentation.copiedURL) {
        return makeImageAttachment(
          data: data,
          fileName: preferredFileName(
            from: provider,
            candidateNames: [fileRepresentation.sourceURL.lastPathComponent],
            fallbackBaseName: "shared-image",
            fallbackExtension: fileRepresentation.sourceURL.pathExtension
          ),
          mimeType: preferredMimeType(for: imageTypeIdentifier, fallbackExtension: fileRepresentation.sourceURL.pathExtension)
        )
      }
    }

    guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
          let fileRepresentation = try await loadFileRepresentation(from: provider, typeIdentifier: UTType.fileURL.identifier),
          isImageURL(fileRepresentation.sourceURL),
          let data = try? Data(contentsOf: fileRepresentation.copiedURL)
    else {
      return nil
    }

    return makeImageAttachment(
      data: data,
      fileName: preferredFileName(
        from: provider,
        candidateNames: [fileRepresentation.sourceURL.lastPathComponent],
        fallbackBaseName: "shared-image",
        fallbackExtension: fileRepresentation.sourceURL.pathExtension
      ),
      mimeType: mimeType(for: fileRepresentation.sourceURL)
    )
  }

  private func loadFileAttachment(from provider: NSItemProvider) async throws -> MemoAttachment? {
    let fileTypeIdentifier = provider.registeredTypeIdentifiers.first(where: { isGenericFileTypeIdentifier($0) })

    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
       let fileRepresentation = try await loadFileRepresentation(from: provider, typeIdentifier: UTType.fileURL.identifier),
       !isImageURL(fileRepresentation.sourceURL),
       let rawData = try? Data(contentsOf: fileRepresentation.copiedURL) {
      let referencedPayload = resolveReferencedFilePayload(from: rawData)
      let fallbackExtension = fileExtension(for: fileTypeIdentifier ?? "") ?? inferredFileExtension(from: provider) ?? fileRepresentation.sourceURL.pathExtension
      let mimeType = fileTypeIdentifier == nil
        ? mimeType(for: referencedPayload?.fileName.flatMap({ URL(fileURLWithPath: $0).pathExtension.isEmpty ? fileRepresentation.sourceURL : URL(fileURLWithPath: $0) }) ?? fileRepresentation.sourceURL)
        : preferredMimeType(for: fileTypeIdentifier ?? "", fallbackExtension: fallbackExtension)
      let resolvedData = referencedPayload?.data ?? rawData
      appendDebugLog("loadFileAttachment:fileURL path=\(fileRepresentation.sourceURL.path) bytes=\(resolvedData.count) mime=\(mimeType)")
      return makeFileAttachment(
        data: resolvedData,
        fileName: preferredFileName(
          from: provider,
          candidateNames: [referencedPayload?.fileName, fileRepresentation.sourceURL.lastPathComponent].compactMap { $0 },
          fallbackBaseName: "shared-file",
          fallbackExtension: fallbackExtension
        ),
        mimeType: mimeType
      )
    }

    if let fileTypeIdentifier,
       let data = try await loadDataRepresentation(from: provider, typeIdentifier: fileTypeIdentifier) {
      appendDebugLog("loadFileAttachment:data type=\(fileTypeIdentifier) bytes=\(data.count)")
      let fallbackExtension = fileExtension(for: fileTypeIdentifier) ?? inferredFileExtension(from: provider) ?? "bin"
      let referencedPayload = resolveReferencedFilePayload(from: data)
      let resolvedData = referencedPayload?.data ?? data
      return makeFileAttachment(
        data: resolvedData,
        fileName: preferredFileName(
          from: provider,
          candidateNames: [referencedPayload?.fileName].compactMap { $0 },
          fallbackBaseName: "shared-file",
          fallbackExtension: fallbackExtension
        ),
        mimeType: preferredMimeType(for: fileTypeIdentifier, fallbackExtension: fallbackExtension)
      )
    }

    return nil
  }

  private func makeImageAttachment(data: Data, fileName: String, mimeType: String) -> MemoAttachment? {
    guard !data.isEmpty else {
      return nil
    }
    let dimensions = imageDimensions(from: data)
    let attachmentId = "att_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16))"
    let caption = fileName.isEmpty ? attachmentId : fileName
    return MemoAttachment(
      id: attachmentId,
      kind: "image",
      fileName: fileName,
      mimeType: mimeType,
      size: data.count,
      caption: caption,
      width: dimensions?.width,
      height: dimensions?.height,
      dataUrl: "data:\(mimeType);base64,\(data.base64EncodedString())"
    )
  }

  private func makeFileAttachment(data: Data, fileName: String, mimeType: String) -> MemoAttachment? {
    guard !data.isEmpty else {
      return nil
    }
    let attachmentId = "att_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16))"
    let caption = fileName.isEmpty ? attachmentId : fileName
    return MemoAttachment(
      id: attachmentId,
      kind: "file",
      fileName: fileName,
      mimeType: mimeType,
      size: data.count,
      caption: caption,
      dataUrl: "data:\(mimeType);base64,\(data.base64EncodedString())"
    )
  }

  private func loadDataRepresentation(from provider: NSItemProvider, typeIdentifier: String) async throws -> Data? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, error in
        if let error {
          self.appendDebugLog("loadDataRepresentation:error type=\(typeIdentifier) error=\(String(describing: error))")
          continuation.resume(throwing: error)
          return
        }
        self.appendDebugLog("loadDataRepresentation:done type=\(typeIdentifier) bytes=\(data?.count ?? 0)")
        continuation.resume(returning: data)
      }
    }
  }

  private func loadFileRepresentation(from provider: NSItemProvider, typeIdentifier: String) async throws -> FileRepresentation? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let url else {
          continuation.resume(returning: nil)
          return
        }

        let tempDirectory = FileManager.default.temporaryDirectory
          .appendingPathComponent("codex-memo-share", isDirectory: true)
        let targetURL = tempDirectory.appendingPathComponent(UUID().uuidString)
          .appendingPathExtension(url.pathExtension)

        do {
          try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
          if FileManager.default.fileExists(atPath: targetURL.path) {
            try FileManager.default.removeItem(at: targetURL)
          }
          try FileManager.default.copyItem(at: url, to: targetURL)
          self.appendDebugLog("loadFileURL:copied type=\(typeIdentifier) source=\(url.path) target=\(targetURL.path)")
          continuation.resume(returning: FileRepresentation(copiedURL: targetURL, sourceURL: url))
        } catch {
          self.appendDebugLog("loadFileURL:error type=\(typeIdentifier) error=\(String(describing: error))")
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func appendDebugLog(_ message: String) {
    let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
    let data = Data(line.utf8)
    if FileManager.default.fileExists(atPath: debugLogURL.path) {
      if let handle = try? FileHandle(forWritingTo: debugLogURL) {
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
      }
      return
    }
    try? data.write(to: debugLogURL, options: .atomic)
  }

  private func preferredFileName(
    from provider: NSItemProvider,
    candidateNames: [String],
    fallbackBaseName: String,
    fallbackExtension: String
  ) -> String {
    if let suggestedName = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines),
       !suggestedName.isEmpty {
      if (suggestedName as NSString).pathExtension.isEmpty {
        if fallbackExtension.isEmpty {
          return suggestedName
        }
        return "\(suggestedName).\(fallbackExtension)"
      }
      return suggestedName
    }
    for candidate in candidateNames {
      let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
      if !isUsefulFileName(trimmed) {
        continue
      }
      if (trimmed as NSString).pathExtension.isEmpty {
        if fallbackExtension.isEmpty {
          return trimmed
        }
        return "\(trimmed).\(fallbackExtension)"
      }
      return trimmed
    }
    if fallbackExtension.isEmpty {
      return fallbackBaseName
    }
    return "\(fallbackBaseName).\(fallbackExtension)"
  }

  private func preferredMimeType(for typeIdentifier: String, fallbackExtension: String) -> String {
    let type = UTType(importedAs: typeIdentifier)
    if let mimeType = type.preferredMIMEType {
      return mimeType
    }
    if let mimeType = UTType(filenameExtension: fallbackExtension)?.preferredMIMEType {
      return mimeType
    }
    return "application/octet-stream"
  }

  private func fileExtension(for typeIdentifier: String) -> String? {
    let type = UTType(importedAs: typeIdentifier)
    return type.preferredFilenameExtension
  }

  private func inferredFileExtension(from provider: NSItemProvider) -> String? {
    provider.registeredTypeIdentifiers
      .compactMap { fileExtension(for: $0) }
      .first(where: { !$0.isEmpty })
  }

  private func mimeType(for fileURL: URL) -> String {
    if let mimeType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType {
      return mimeType
    }
    return "application/octet-stream"
  }

  private func resolveReferencedFilePayload(from data: Data) -> ResolvedFilePayload? {
    guard data.count < 2048,
          let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          text.hasPrefix("file://"),
          let referencedURL = URL(string: text),
          referencedURL.isFileURL
    else {
      return nil
    }
    guard let resolvedData = try? Data(contentsOf: referencedURL) else {
      return nil
    }
    return ResolvedFilePayload(data: resolvedData, fileName: referencedURL.lastPathComponent)
  }

  private func isUsefulFileName(_ value: String) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return false
    }
    let baseName = (trimmed as NSString).deletingPathExtension
    if baseName.range(of: #"^[A-Fa-f0-9-]{16,}$"#, options: .regularExpression) != nil {
      return false
    }
    return true
  }

  private func isImageURL(_ url: URL) -> Bool {
    guard !url.pathExtension.isEmpty else { return false }
    guard let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType else {
      return false
    }
    return mimeType.hasPrefix("image/")
  }

  private func isGenericFileTypeIdentifier(_ typeIdentifier: String) -> Bool {
    if ignoredFileTypeIdentifiers.contains(typeIdentifier) {
      return false
    }
    let type = UTType(importedAs: typeIdentifier)
    if type.conforms(to: .image) || type.conforms(to: .url) || type.conforms(to: .plainText) {
      return false
    }
    return true
  }

  private func isFileSchemeURLString(_ value: String) -> Bool {
    guard let url = URL(string: value) else { return false }
    return url.isFileURL || value.hasPrefix("file://")
  }

  private func imageDimensions(from data: Data) -> (width: Int, height: Int)? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int
    else {
      return nil
    }
    return (width, height)
  }

  private func loadURLLikeValue(from provider: NSItemProvider, typeIdentifier: String) async throws -> String? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        if let url = item as? URL {
          continuation.resume(returning: url.absoluteString)
          return
        }
        if let text = item as? String {
          continuation.resume(returning: text)
          return
        }
        if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
          continuation.resume(returning: text)
          return
        }
        continuation.resume(returning: nil)
      }
    }
  }
}
