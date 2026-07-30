#![no_std]
//! On-chain Groth16 verifier over BLS12-381 for `retirement_private_cert`.
//!
//! Follows the Stellar CAP-0059 / soroban-examples `groth16_verifier` pattern.
//! Production VKs MUST come from a multi-party trusted setup — see
//! `docs/zk-proof-security-analysis.md`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Env, Symbol, Vec,
};

const VK_KEY: Symbol = symbol_short!("VK");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ZkVerifierError {
    MalformedVerifyingKey = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
}

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

#[contract]
pub struct CarbonZkVerifier;

#[contractimpl]
impl CarbonZkVerifier {
    /// Store the circuit verification key (admin / deployer).
    pub fn initialize(env: Env, vk: VerificationKey) -> Result<(), ZkVerifierError> {
        if env.storage().instance().has(&VK_KEY) {
            return Err(ZkVerifierError::AlreadyInitialized);
        }
        if vk.ic.len() < 2 {
            return Err(ZkVerifierError::MalformedVerifyingKey);
        }
        env.storage().instance().set(&VK_KEY, &vk);
        Ok(())
    }

    /// Verify a Groth16 proof against stored VK and public signals.
    ///
    /// Public signal order (retirement_private_cert):
    /// 0 = beneficiaryCommitment, 1 = nullifier, 2 = retiredByHash
    pub fn verify_proof(
        env: Env,
        proof: Proof,
        pub_signals: Vec<Fr>,
    ) -> Result<bool, ZkVerifierError> {
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&VK_KEY)
            .ok_or(ZkVerifierError::NotInitialized)?;
        Self::verify_with_vk(env, vk, proof, pub_signals)
    }

    /// Stateless verify (useful for tests / one-shot verification without init).
    pub fn verify_with_vk(
        env: Env,
        vk: VerificationKey,
        proof: Proof,
        pub_signals: Vec<Fr>,
    ) -> Result<bool, ZkVerifierError> {
        let bls = env.crypto().bls12_381();

        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(ZkVerifierError::MalformedVerifyingKey);
        }

        // vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bls.g1_mul(&v, &s);
            vk_x = bls.g1_add(&vk_x, &prod);
        }

        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = -proof.a;
        let vp1 = vec![&env, neg_a, vk.alpha, vk_x, proof.c];
        let vp2 = vec![&env, proof.b, vk.beta, vk.gamma, vk.delta];

        Ok(bls.pairing_check(vp1, vp2))
    }
}

#[cfg(test)]
mod test;
