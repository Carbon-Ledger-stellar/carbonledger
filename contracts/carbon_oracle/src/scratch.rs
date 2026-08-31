use soroban_sdk::{Env, String, Bytes};
pub fn test(env: Env, s: String) -> Bytes {
    use soroban_sdk::xdr::ToXdr;
    s.to_xdr(&env)
}
