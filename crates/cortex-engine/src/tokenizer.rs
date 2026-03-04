use std::sync::OnceLock;
use tiktoken_rs::CoreBPE;

static BPE: OnceLock<CoreBPE> = OnceLock::new();

fn get_bpe() -> &'static CoreBPE {
    BPE.get_or_init(|| tiktoken_rs::cl100k_base().expect("Failed to load cl100k_base tokenizer"))
}

pub fn count_tokens(text: &str) -> u32 {
    get_bpe().encode_ordinary(text).len() as u32
}

pub fn count_tokens_batch(texts: &[String]) -> Vec<u32> {
    let bpe = get_bpe();
    texts
        .iter()
        .map(|t| bpe.encode_ordinary(t).len() as u32)
        .collect()
}
