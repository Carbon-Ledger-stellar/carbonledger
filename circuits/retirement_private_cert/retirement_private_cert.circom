pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/*
 * Retirement Private Certificate circuit (Groth16 / BLS12-381)
 *
 * Private inputs encode a retirement record + blinding salt.
 * Public outputs hide beneficiary / amount / project while binding
 * the certificate to a wallet hash and a unique nullifier.
 *
 * Public:
 *   beneficiaryCommitment = Poseidon(beneficiary, salt)
 *   nullifier              = Poseidon(retirementId, salt)
 *   retiredByHash          = Poseidon(retiredBy)
 *
 * Constraints:
 *   serialEnd >= serialStart
 *   amount > 0
 */
template RetirementPrivateCert() {
    // ── Private ────────────────────────────────────────────────────────────
    signal input beneficiary;
    signal input salt;
    signal input retirementId;
    signal input amount;
    signal input projectId;
    signal input serialStart;
    signal input serialEnd;
    signal input retiredBy;

    // ── Public ─────────────────────────────────────────────────────────────
    signal output beneficiaryCommitment;
    signal output nullifier;
    signal output retiredByHash;

    // amount > 0
    component amountPositive = GreaterThan(64);
    amountPositive.in[0] <== amount;
    amountPositive.in[1] <== 0;
    amountPositive.out === 1;

    // serialEnd >= serialStart  ⇔  serialEnd + 1 > serialStart
    component serialOrder = GreaterThan(64);
    serialOrder.in[0] <== serialEnd + 1;
    serialOrder.in[1] <== serialStart;
    serialOrder.out === 1;

    // Keep projectId in the witness (bound by proving from DB record).
    // Squaring forces the signal to be used so the compiler keeps it.
    signal projectIdSq;
    projectIdSq <== projectId * projectId;

    component commit = Poseidon(2);
    commit.inputs[0] <== beneficiary;
    commit.inputs[1] <== salt;
    beneficiaryCommitment <== commit.out;

    component nullH = Poseidon(2);
    nullH.inputs[0] <== retirementId;
    nullH.inputs[1] <== salt;
    nullifier <== nullH.out;

    component walletH = Poseidon(1);
    walletH.inputs[0] <== retiredBy;
    retiredByHash <== walletH.out;
}

component main = RetirementPrivateCert();
