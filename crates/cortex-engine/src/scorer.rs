use crate::types::MemoryEntry;

pub struct ScorerConfig {
    pub default_ttl: f64,
    pub decay_threshold: f64,
    pub recency_boost_minutes: f64,
    pub recency_boost_multiplier: f64,
}

impl Default for ScorerConfig {
    fn default() -> Self {
        Self {
            default_ttl: 24.0,
            decay_threshold: 0.95,
            recency_boost_minutes: 30.0,
            recency_boost_multiplier: 1.3,
        }
    }
}

/// Calculate decay factor (0.0 = fresh, 1.0 = fully decayed)
pub fn calculate_decay(age_in_seconds: f64, ttl_in_seconds: f64) -> f64 {
    if ttl_in_seconds == 0.0 {
        return 1.0;
    }
    if age_in_seconds <= 0.0 {
        return 0.0;
    }

    let ratio = age_in_seconds / ttl_in_seconds;
    let decay = 1.0 - (-ratio).exp();
    decay.clamp(0.0, 1.0)
}

/// Calculate current score for an entry based on decay and access count
pub fn calculate_score(entry: &MemoryEntry, current_time: f64, config: &ScorerConfig) -> f64 {
    let age_ms = current_time - entry.timestamp;
    let age_seconds = (age_ms / 1000.0).max(0.0);

    let decay = calculate_decay(age_seconds, entry.ttl);
    let mut score = entry.score * (1.0 - decay);

    // Access count bonus (diminishing returns via log)
    if entry.access_count > 0 {
        let access_bonus = (entry.access_count as f64 + 1.0).ln() * 0.1;
        score = (score + access_bonus).min(1.0);
    }

    // BTSP entries maintain high score
    if entry.is_btsp {
        score = score.max(0.9);
    }

    // Recency boost for non-BTSP entries
    let recency_window_ms = config.recency_boost_minutes * 60.0 * 1000.0;
    if !entry.is_btsp && recency_window_ms > 0.0 {
        let age_ms_val = current_time - entry.timestamp;
        if age_ms_val >= 0.0 && age_ms_val < recency_window_ms {
            let boost_factor =
                1.0 + (config.recency_boost_multiplier - 1.0) * (1.0 - age_ms_val / recency_window_ms);
            score *= boost_factor;
        }
    }

    score.clamp(0.0, 1.0)
}

/// Classify entry into confidence state
pub fn classify_state(score: f64, is_btsp: bool, active_threshold: f64, ready_threshold: f64) -> &'static str {
    if is_btsp || score >= active_threshold {
        "active"
    } else if score >= ready_threshold {
        "ready"
    } else {
        "silent"
    }
}
