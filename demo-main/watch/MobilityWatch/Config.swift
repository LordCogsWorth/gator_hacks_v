import Foundation

/// Supabase settings, injected from Config.xcconfig into Info.plist at build time
/// (keys SupabaseURL, SupabaseAnonKey, PatientID). If any is missing, uploads are skipped.
enum Config {
    private static func value(_ key: String) -> String {
        let v = (Bundle.main.infoDictionary?[key] as? String ?? "").trimmingCharacters(in: .whitespaces)
        return v.hasPrefix("$(") ? "" : v // unresolved build setting
    }

    static let supabaseURL: URL? = URL(string: value("SupabaseURL")).flatMap { $0.host == nil ? nil : $0 }
    static let anonKey: String = value("SupabaseAnonKey")
    static let patientId: String = value("PatientID")

    static var isConfigured: Bool { supabaseURL != nil && !anonKey.isEmpty && !patientId.isEmpty }
}
