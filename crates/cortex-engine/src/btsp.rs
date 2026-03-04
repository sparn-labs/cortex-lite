use regex::RegexSet;
use std::sync::OnceLock;

static BTSP_PATTERNS: OnceLock<RegexSet> = OnceLock::new();

fn get_patterns() -> &'static RegexSet {
    BTSP_PATTERNS.get_or_init(|| {
        RegexSet::new([
            // Error patterns
            r"(?i)\b(error|exception|failure|fatal|critical|panic)\b",
            r"\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError)\b",
            r"\bENOENT|EACCES|ECONNREFUSED|ETIMEDOUT\b",
            // Stack trace patterns
            r"(?m)^\s+at\s+.*\(.*:\d+:\d+\)",
            r"(?m)^\s+at\s+.*\.[a-zA-Z]+:\d+",
            // Git diff new files
            r"(?m)^new file mode \d+$",
            r"(?m)^--- /dev/null$",
            // Merge conflict markers
            r"(?m)^<<<<<<< ",
            r"(?m)^=======$",
            r"(?m)^>>>>>>> ",
        ])
        .expect("Failed to compile BTSP regex patterns")
    })
}

pub fn detect_btsp(content: &str) -> bool {
    get_patterns().is_match(content)
}
