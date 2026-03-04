mod btsp;
mod consolidator;
mod hash;
mod pruner;
mod scorer;
mod tfidf;
mod tokenizer;
mod types;

use napi_derive::napi;
use types::{ConsolidateResult, EngineConfig, EngineStats, MemoryEntry, PruneResult};

#[napi]
pub struct CortexEngine {
    pruner: pruner::Pruner,
    scorer_config: scorer::ScorerConfig,
    active_threshold: f64,
    ready_threshold: f64,
}

#[napi]
impl CortexEngine {
    #[napi(constructor)]
    pub fn new(config: Option<EngineConfig>) -> Self {
        let config = config.unwrap_or(EngineConfig {
            token_budget: None,
            default_ttl: None,
            decay_threshold: None,
            active_threshold: None,
            ready_threshold: None,
            full_optimization_interval: None,
            recency_boost_minutes: None,
            recency_boost_multiplier: None,
        });

        let active_threshold = config.active_threshold.unwrap_or(0.7);
        let ready_threshold = config.ready_threshold.unwrap_or(0.3);

        let scorer_config = scorer::ScorerConfig {
            default_ttl: config.default_ttl.unwrap_or(24.0),
            decay_threshold: config.decay_threshold.unwrap_or(0.95),
            recency_boost_minutes: config.recency_boost_minutes.unwrap_or(30.0),
            recency_boost_multiplier: config.recency_boost_multiplier.unwrap_or(1.3),
        };

        let pruner_config = pruner::PrunerConfig {
            token_budget: config.token_budget.unwrap_or(40000),
            full_optimization_interval: config.full_optimization_interval.unwrap_or(50),
            active_threshold,
            ready_threshold,
        };

        Self {
            pruner: pruner::Pruner::new(pruner_config, scorer::ScorerConfig {
                default_ttl: scorer_config.default_ttl,
                decay_threshold: scorer_config.decay_threshold,
                recency_boost_minutes: scorer_config.recency_boost_minutes,
                recency_boost_multiplier: scorer_config.recency_boost_multiplier,
            }),
            scorer_config,
            active_threshold,
            ready_threshold,
        }
    }

    /// Full optimization pipeline: score → prune → fit to budget
    #[napi]
    pub fn optimize(&mut self, entries: Vec<MemoryEntry>, budget: Option<u32>) -> PruneResult {
        self.pruner.optimize(entries, budget)
    }

    /// Consolidation: remove decayed + merge duplicates
    #[napi]
    pub fn consolidate(&self, entries: Vec<MemoryEntry>) -> ConsolidateResult {
        consolidator::consolidate(entries, &self.scorer_config)
    }

    /// Count tokens using tiktoken cl100k_base
    #[napi]
    pub fn count_tokens(&self, text: String) -> u32 {
        tokenizer::count_tokens(&text)
    }

    /// Count tokens for multiple texts
    #[napi]
    pub fn count_tokens_batch(&self, texts: Vec<String>) -> Vec<u32> {
        tokenizer::count_tokens_batch(&texts)
    }

    /// Detect BTSP patterns in content
    #[napi]
    pub fn detect_btsp(&self, content: String) -> bool {
        btsp::detect_btsp(&content)
    }

    /// Hash content using SHA-256
    #[napi]
    pub fn hash_content(&self, content: String) -> String {
        hash::hash_content(&content)
    }

    /// Calculate score for a single entry
    #[napi]
    pub fn calculate_score(&self, entry: MemoryEntry, current_time: Option<f64>) -> f64 {
        let now = current_time.unwrap_or_else(|| {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as f64
        });
        scorer::calculate_score(&entry, now, &self.scorer_config)
    }

    /// Classify entry into confidence state
    #[napi]
    pub fn classify_state(&self, score: f64, is_btsp: bool) -> String {
        scorer::classify_state(score, is_btsp, self.active_threshold, self.ready_threshold)
            .to_string()
    }

    /// Reset all internal state
    #[napi]
    pub fn reset(&mut self) {
        self.pruner.reset();
    }

    /// Get engine statistics
    #[napi]
    pub fn get_stats(&self) -> EngineStats {
        let (cached, terms, docs, updates) = self.pruner.get_stats();
        EngineStats {
            cached_entries: cached,
            unique_terms: terms,
            total_documents: docs,
            update_count: updates,
        }
    }
}

// Standalone function exports for direct use without engine instance

#[napi]
pub fn count_tokens(text: String) -> u32 {
    tokenizer::count_tokens(&text)
}

#[napi]
pub fn count_tokens_batch(texts: Vec<String>) -> Vec<u32> {
    tokenizer::count_tokens_batch(&texts)
}

#[napi]
pub fn detect_btsp(content: String) -> bool {
    btsp::detect_btsp(&content)
}

#[napi]
pub fn hash_content(content: String) -> String {
    hash::hash_content(&content)
}
