import Foundation

struct MemoAttachment: Encodable {
  let id: String
  let kind: String
  let fileName: String
  let mimeType: String
  let size: Int
  let caption: String
  let width: Int?
  let height: Int?
  let dataUrl: String?
  let createdAtISO: String

  init(
    id: String,
    kind: String,
    fileName: String,
    mimeType: String,
    size: Int,
    caption: String = "",
    width: Int? = nil,
    height: Int? = nil,
    dataUrl: String? = nil,
    createdAtISO: String = ISO8601DateFormatter().string(from: Date())
  ) {
    self.id = id
    self.kind = kind
    self.fileName = fileName
    self.mimeType = mimeType
    self.size = size
    self.caption = caption
    self.width = width
    self.height = height
    self.dataUrl = dataUrl
    self.createdAtISO = createdAtISO
  }
}

struct MemoDraft: Encodable {
  let projectName: String
  let memoType: String
  let threadTitle: String
  let memoBody: String
  let attachments: [MemoAttachment]
  let createdBy: String
  let sourceThread: String
  let deletable: Bool

  init(
    projectName: String,
    memoType: String,
    threadTitle: String,
    memoBody: String,
    attachments: [MemoAttachment] = [],
    createdBy: String,
    sourceThread: String,
    deletable: Bool = false
  ) {
    self.projectName = projectName
    self.memoType = memoType
    self.threadTitle = threadTitle
    self.memoBody = memoBody
    self.attachments = attachments
    self.createdBy = createdBy
    self.sourceThread = sourceThread
    self.deletable = deletable
  }

  static func composeBody(sections: [String]) -> String {
    let body = sections.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return body.isEmpty ? "Shared from macOS" : body
  }

  static func makeTitle(from body: String, fallback: String) -> String {
    let compact = body
      .split(whereSeparator: \.isNewline)
      .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
      .first(where: { !$0.isEmpty }) ?? fallback
    return String(compact.prefix(40))
  }
}
