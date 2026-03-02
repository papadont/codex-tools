import Foundation

struct SaveMemoResponse: Decodable {
  struct Item: Decodable {
    let id: String
  }

  let item: Item
}

enum LocalMemoAPIError: LocalizedError {
  case invalidResponse
  case httpError(Int, String)

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      return "codex-memo API の応答が不正"
    case let .httpError(code, body):
      if body.isEmpty {
        return "codex-memo API が HTTP \(code) を返した"
      }
      return "codex-memo API が HTTP \(code): \(body)"
    }
  }
}

final class LocalMemoAPI {
  let baseURL: URL
  private let session: URLSession

  init(
    baseURL: URL = URL(string: "http://127.0.0.1:4173")!,
    session: URLSession = .shared
  ) {
    self.baseURL = baseURL
    self.session = session
  }

  func healthCheck() async throws -> Bool {
    let url = baseURL.appending(path: "api/runtime-config")
    var request = URLRequest(url: url)
    request.timeoutInterval = 2
    let (_, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw LocalMemoAPIError.invalidResponse
    }
    return (200..<300).contains(http.statusCode)
  }

  func save(draft: MemoDraft) async throws -> String {
    let url = baseURL.appending(path: "api/memos")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(draft)

    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw LocalMemoAPIError.invalidResponse
    }
    guard (200..<300).contains(http.statusCode) else {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw LocalMemoAPIError.httpError(http.statusCode, body)
    }

    let decoded = try JSONDecoder().decode(SaveMemoResponse.self, from: data)
    return decoded.item.id
  }
}
