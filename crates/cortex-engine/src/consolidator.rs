use std::collections::{HashMap, HashSet};

use crate::scorer::{calculate_decay, ScorerConfig};
use crate::tfidf::tokenize;
use crate::types::{ConsolidateResult, MemoryEntry};

/// Calculate cosine similarity between two texts using word frequency vectors
fn cosine_similarity(text1: &str, text2: &str) -> f64 {
    let words1 = tokenize(text1);
    let words2 = tokenize(text2);

    let mut vec1: HashMap<&str, f64> = HashMap::new();
    let mut vec2: HashMap<&str, f64> = HashMap::new();

    for word in &words1 {
        *vec1.entry(word.as_str()).or_insert(0.0) += 1.0;
    }
    for word in &words2 {
        *vec2.entry(word.as_str()).or_insert(0.0) += 1.0;
    }

    let mut vocab: HashSet<&str> = HashSet::new();
    for w in &words1 {
        vocab.insert(w.as_str());
    }
    for w in &words2 {
        vocab.insert(w.as_str());
    }

    let mut dot_product = 0.0;
    let mut mag1 = 0.0;
    let mut mag2 = 0.0;

    for word in &vocab {
        let c1 = vec1.get(word).copied().unwrap_or(0.0);
        let c2 = vec2.get(word).copied().unwrap_or(0.0);
        dot_product += c1 * c2;
        mag1 += c1 * c1;
        mag2 += c2 * c2;
    }

    mag1 = mag1.sqrt();
    mag2 = mag2.sqrt();

    if mag1 == 0.0 || mag2 == 0.0 {
        return 0.0;
    }

    dot_product / (mag1 * mag2)
}

struct DuplicateGroup {
    entries: Vec<usize>,
    #[allow(dead_code)]
    similarity: f64,
}

pub fn consolidate(entries: Vec<MemoryEntry>, config: &ScorerConfig) -> ConsolidateResult {
    let start = std::time::Instant::now();
    let original_count = entries.len() as u32;

    let now = js_sys_now();

    // Step 1: Remove fully decayed entries (decay >= 0.95)
    let non_decayed: Vec<&MemoryEntry> = entries
        .iter()
        .filter(|entry| {
            let age_seconds = ((now - entry.timestamp) / 1000.0).max(0.0);
            let decay = calculate_decay(age_seconds, entry.ttl);
            decay < config.decay_threshold
        })
        .collect();

    let decayed_removed = original_count - non_decayed.len() as u32;

    // Step 2: Find duplicates (exact hash + near-duplicate cosine >= 0.85)
    let mut processed: HashSet<usize> = HashSet::new();
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    // Exact hash matches
    let mut hash_map: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, entry) in non_decayed.iter().enumerate() {
        hash_map.entry(entry.hash.as_str()).or_default().push(i);
    }

    for (_hash, indices) in &hash_map {
        if indices.len() > 1 {
            for &i in indices {
                processed.insert(i);
            }
            groups.push(DuplicateGroup {
                entries: indices.clone(),
                similarity: 1.0,
            });
        }
    }

    // Near-duplicates via cosine similarity
    for i in 0..non_decayed.len() {
        if processed.contains(&i) {
            continue;
        }
        for j in (i + 1)..non_decayed.len() {
            if processed.contains(&j) {
                continue;
            }
            let sim = cosine_similarity(&non_decayed[i].content, &non_decayed[j].content);
            if sim >= 0.85 {
                processed.insert(i);
                processed.insert(j);
                groups.push(DuplicateGroup {
                    entries: vec![i, j],
                    similarity: sim,
                });
                break;
            }
        }
    }

    // Step 3: Merge duplicates (keep highest score, sum access counts, merge tags)
    let mut merged: Vec<MemoryEntry> = Vec::new();
    let mut duplicate_ids: HashSet<usize> = HashSet::new();

    for group in &groups {
        for &idx in &group.entries {
            duplicate_ids.insert(idx);
        }

        // Find best entry (highest score)
        let best_idx = *group
            .entries
            .iter()
            .max_by(|&&a, &&b| {
                non_decayed[a]
                    .score
                    .partial_cmp(&non_decayed[b].score)
                    .unwrap()
            })
            .unwrap();

        let mut best = non_decayed[best_idx].clone();

        // Sum access counts
        let total_access: u32 = group
            .entries
            .iter()
            .map(|&i| non_decayed[i].access_count)
            .sum();
        best.access_count = total_access;

        // Merge tags
        let mut all_tags: HashSet<String> = HashSet::new();
        for &idx in &group.entries {
            for tag in &non_decayed[idx].tags {
                all_tags.insert(tag.clone());
            }
        }
        best.tags = all_tags.into_iter().collect();

        merged.push(best);
    }

    // Non-duplicate entries
    let non_duplicates: Vec<MemoryEntry> = non_decayed
        .iter()
        .enumerate()
        .filter(|(i, _)| !duplicate_ids.contains(i))
        .map(|(_, e)| (*e).clone())
        .collect();

    let mut kept = merged;
    kept.extend(non_duplicates);

    let duplicates_removed: u32 = groups.iter().map(|g| g.entries.len() as u32 - 1).sum();

    // Build removed list
    let kept_ids: HashSet<&str> = kept.iter().map(|e| e.id.as_str()).collect();
    let removed: Vec<MemoryEntry> = entries
        .into_iter()
        .filter(|e| !kept_ids.contains(e.id.as_str()))
        .collect();

    let entries_after = kept.len() as u32;
    let compression_ratio = if original_count > 0 {
        entries_after as f64 / original_count as f64
    } else {
        0.0
    };

    ConsolidateResult {
        kept,
        removed,
        entries_before: original_count,
        entries_after,
        decayed_removed,
        duplicates_removed,
        compression_ratio,
        duration_ms: start.elapsed().as_secs_f64() * 1000.0,
    }
}

fn js_sys_now() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}
