use std::collections::HashMap;

use crate::scorer::{calculate_score, ScorerConfig};
use crate::tfidf::{create_tfidf_index, score_tfidf, TFIDFIndex};
use crate::tokenizer;
use crate::types::{MemoryEntry, PruneResult};

/// Cached score for incremental optimization
#[allow(dead_code)]
struct CachedScore {
    score: f64,
    timestamp: f64,
}

const MAX_CACHE_SIZE: usize = 10_000;

pub struct Pruner {
    config: PrunerConfig,
    scorer_config: ScorerConfig,
    cache: HashMap<String, CachedScore>,
    document_frequency: HashMap<String, u32>,
    total_documents: u32,
    pub update_count: u32,
}

#[allow(dead_code)]
pub struct PrunerConfig {
    pub token_budget: u32,
    pub full_optimization_interval: u32,
    pub active_threshold: f64,
    pub ready_threshold: f64,
}

impl Pruner {
    pub fn new(config: PrunerConfig, scorer_config: ScorerConfig) -> Self {
        Self {
            config,
            scorer_config,
            cache: HashMap::new(),
            document_frequency: HashMap::new(),
            total_documents: 0,
            update_count: 0,
        }
    }

    fn get_state_multiplier(entry: &MemoryEntry) -> f64 {
        if entry.is_btsp {
            return 2.0;
        }
        match entry.state.as_str() {
            "active" => 2.0,
            "ready" => 1.0,
            "silent" => 0.5,
            _ => 1.0,
        }
    }

    fn priority_score(&self, entry: &MemoryEntry, index: &TFIDFIndex) -> f64 {
        let tfidf = score_tfidf(entry, index);
        let now = js_sys_now();
        let current_score = calculate_score(entry, now, &self.scorer_config);
        let state_multiplier = Self::get_state_multiplier(entry);

        tfidf * current_score * state_multiplier
    }

    pub fn optimize(&mut self, entries: Vec<MemoryEntry>, budget: Option<u32>) -> PruneResult {
        let budget = budget.unwrap_or(self.config.token_budget);

        if entries.is_empty() {
            return PruneResult {
                kept: vec![],
                removed: vec![],
                original_tokens: 0,
                pruned_tokens: 0,
                budget_utilization: 0.0,
            };
        }

        // Calculate original token count
        let original_tokens: u32 = entries
            .iter()
            .map(|e| tokenizer::count_tokens(&e.content))
            .sum();

        // Separate BTSP entries
        let (btsp_entries, regular_entries): (Vec<_>, Vec<_>) =
            entries.iter().partition(|e| e.is_btsp);

        // Include BTSP entries up to 80% of budget
        let mut included_btsp: Vec<&MemoryEntry> = Vec::new();
        let mut btsp_tokens: u32 = 0;
        let mut sorted_btsp: Vec<&&MemoryEntry> = btsp_entries.iter().collect();
        sorted_btsp.sort_by(|a, b| b.timestamp.partial_cmp(&a.timestamp).unwrap());

        for entry in &sorted_btsp {
            let tokens = tokenizer::count_tokens(&entry.content);
            if btsp_tokens + tokens <= (budget as f64 * 0.8) as u32 {
                included_btsp.push(entry);
                btsp_tokens += tokens;
            }
        }

        // If no BTSP fits, include at least the most recent one
        if included_btsp.is_empty() && !sorted_btsp.is_empty() {
            let first = sorted_btsp[0];
            included_btsp.push(first);
            btsp_tokens = tokenizer::count_tokens(&first.content);
        }

        let excluded_btsp: Vec<&MemoryEntry> = btsp_entries
            .iter()
            .filter(|e| !included_btsp.iter().any(|b| b.id == e.id))
            .copied()
            .collect();

        // Build TF-IDF index and score regular entries
        let tfidf_index = create_tfidf_index(&entries);
        let mut scored: Vec<(&MemoryEntry, f64, u32)> = regular_entries
            .iter()
            .map(|entry| {
                let score = self.priority_score(entry, &tfidf_index);
                let tokens = tokenizer::count_tokens(&entry.content);
                (*entry, score, tokens)
            })
            .collect();

        // Sort by priority score descending
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // Greedy fill until budget exceeded
        let mut kept: Vec<MemoryEntry> = included_btsp.into_iter().cloned().collect();
        let mut removed: Vec<MemoryEntry> = excluded_btsp.into_iter().cloned().collect();
        let mut current_tokens = btsp_tokens;

        for (entry, _score, tokens) in scored {
            if current_tokens + tokens <= budget {
                kept.push(entry.clone());
                current_tokens += tokens;
            } else {
                removed.push(entry.clone());
            }
        }

        let budget_utilization = if budget > 0 {
            current_tokens as f64 / budget as f64
        } else {
            0.0
        };

        // Update cache
        self.update_count += 1;
        for entry in &kept {
            self.cache.insert(
                entry.hash.clone(),
                CachedScore {
                    score: 0.0,
                    timestamp: js_sys_now(),
                },
            );
        }
        for entry in &removed {
            self.cache.remove(&entry.hash);
        }

        // Evict oldest cache entries if over limit
        if self.cache.len() > MAX_CACHE_SIZE {
            let mut entries_vec: Vec<(String, f64)> = self
                .cache
                .iter()
                .map(|(k, v)| (k.clone(), v.timestamp))
                .collect();
            entries_vec.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            let to_remove = self.cache.len() - MAX_CACHE_SIZE + MAX_CACHE_SIZE / 5;
            for (key, _) in entries_vec.iter().take(to_remove) {
                self.cache.remove(key);
            }
        }

        PruneResult {
            kept,
            removed,
            original_tokens,
            pruned_tokens: current_tokens,
            budget_utilization,
        }
    }

    pub fn reset(&mut self) {
        self.cache.clear();
        self.document_frequency.clear();
        self.total_documents = 0;
        self.update_count = 0;
    }

    pub fn get_stats(&self) -> (u32, u32, u32, u32) {
        (
            self.cache.len() as u32,
            self.document_frequency.len() as u32,
            self.total_documents,
            self.update_count,
        )
    }
}

/// Get current time in milliseconds (JS-compatible)
fn js_sys_now() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}
