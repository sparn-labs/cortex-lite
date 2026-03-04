use std::collections::{HashMap, HashSet};

use crate::types::MemoryEntry;

/// Tokenize text into lowercase words
pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| w.to_string())
        .collect()
}

/// Pre-computed TF-IDF index for O(1) document frequency lookups
pub struct TFIDFIndex {
    pub document_frequency: HashMap<String, u32>,
    pub total_documents: u32,
}

/// Build a pre-computed TF-IDF index from entries
pub fn create_tfidf_index(entries: &[MemoryEntry]) -> TFIDFIndex {
    let mut document_frequency: HashMap<String, u32> = HashMap::new();

    for entry in entries {
        let tokens = tokenize(&entry.content);
        let unique_terms: HashSet<&String> = tokens.iter().collect();

        for term in unique_terms {
            *document_frequency.entry(term.clone()).or_insert(0) += 1;
        }
    }

    TFIDFIndex {
        document_frequency,
        total_documents: entries.len() as u32,
    }
}

/// Calculate TF with sqrt capping
fn calculate_tf(term: &str, tokens: &[String]) -> f64 {
    let count = tokens.iter().filter(|t| t.as_str() == term).count();
    (count as f64).sqrt()
}

/// Score an entry using a pre-computed TF-IDF index
pub fn score_tfidf(entry: &MemoryEntry, index: &TFIDFIndex) -> f64 {
    let tokens = tokenize(&entry.content);
    if tokens.is_empty() {
        return 0.0;
    }

    let unique_terms: HashSet<&String> = tokens.iter().collect();
    let mut total_score = 0.0;

    for term in unique_terms {
        let tf = calculate_tf(term, &tokens);
        let docs_with_term = index.document_frequency.get(term.as_str()).copied().unwrap_or(0);

        if docs_with_term == 0 {
            continue;
        }

        let idf = (index.total_documents as f64 / docs_with_term as f64).ln();
        total_score += tf * idf;
    }

    total_score / tokens.len() as f64
}
