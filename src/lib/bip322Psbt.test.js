import { Buffer } from 'buffer';
import { secp256k1 } from '@noble/curves/secp256k1';
import { networks, payments, Psbt } from 'bitcoinjs-lib';
import { buildBip322Psbt, getPsbtAddressType } from './bip322Psbt';

const toHex = (value) => Buffer.from(value).toString('hex');
const validator = (publicKey, hash, signature) => secp256k1.verify(
  toHex(signature),
  toHex(hash),
  toHex(publicKey),
);

const MESSAGE = 'Bitcoin Access authentication request\nrequest_id: test';
const P2WPKH_ADDRESS = 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l';
const MULTISIG_PUBKEYS = [
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
].map((key) => Buffer.from(key, 'hex'));
const privateKey = (value) => {
  const key = value.toString(16).padStart(64, '0');
  return {
    publicKey: Buffer.from(secp256k1.getPublicKey(key, true)),
    sign: (hash) => Buffer.from(secp256k1.sign(toHex(hash), key).toCompactRawBytes()),
  };
};

test('builds a non-broadcastable BIP-322 PSBT for Native SegWit', () => {
  const result = buildBip322Psbt({ address: P2WPKH_ADDRESS, message: MESSAGE });
  const psbt = Psbt.fromBase64(result.base64);

  expect(result.addressType).toBe('p2wpkh');
  expect([...Buffer.from(result.base64, 'base64').subarray(0, 5)]).toEqual([112, 115, 98, 116, 255]);
  expect(psbt.data.globalMap.unknownKeyVals).toEqual([{
    key: Buffer.from([0x09]),
    value: Buffer.from(MESSAGE),
  }]);
});

test('produces a signable Legacy P2PKH proof with the virtual previous transaction', () => {
  const signer = privateKey(4);
  const wallet = payments.p2pkh({ pubkey: signer.publicKey, network: networks.bitcoin });
  const proof = buildBip322Psbt({ address: wallet.address, message: MESSAGE });
  const signed = Psbt.fromBase64(proof.base64);

  expect(proof.addressType).toBe('p2pkh');
  expect(getPsbtAddressType(wallet.address)).toBe('p2pkh');
  expect(signed.data.inputs[0].nonWitnessUtxo).toBeTruthy();
  signed.signInput(0, signer);
  expect(signed.validateSignaturesOfInput(0, validator)).toBe(true);
  expect(() => signed.finalizeInput(0)).not.toThrow();
  expect(signed.data.inputs[0].finalScriptSig).toBeTruthy();
});

test('produces a signable Nested SegWit sh(wpkh) proof', () => {
  const signer = privateKey(5);
  const redeem = payments.p2wpkh({ pubkey: signer.publicKey, network: networks.bitcoin });
  const wallet = payments.p2sh({ redeem, network: networks.bitcoin });
  const proof = buildBip322Psbt({
    address: wallet.address,
    message: MESSAGE,
    redeemScriptHex: redeem.output.toString('hex'),
  });
  const signed = Psbt.fromBase64(proof.base64);

  expect(proof.addressType).toBe('p2sh-p2wpkh');
  expect(signed.data.inputs[0].redeemScript).toEqual(redeem.output);
  signed.signInput(0, signer);
  expect(signed.validateSignaturesOfInput(0, validator)).toBe(true);
  expect(() => signed.finalizeInput(0)).not.toThrow();
  expect(signed.data.inputs[0].finalScriptWitness).toBeTruthy();
});

test('rejects a P2SH proof without a matching Nested SegWit redeem script', () => {
  const signer = privateKey(6);
  const redeem = payments.p2wpkh({ pubkey: signer.publicKey, network: networks.bitcoin });
  const wallet = payments.p2sh({ redeem, network: networks.bitcoin });

  expect(() => buildBip322Psbt({ address: wallet.address, message: MESSAGE })).toThrow(
    'requires the public redeem script',
  );
});

test('includes descriptor key origins for hardware-wallet recognition', () => {
  const signer = privateKey(1);
  const wallet = payments.p2wpkh({ pubkey: signer.publicKey, network: networks.bitcoin });
  const result = buildBip322Psbt({
    address: wallet.address,
    message: MESSAGE,
    bip32Derivations: [{
      masterFingerprint: Buffer.from('d34db33f', 'hex'),
      pubkey: signer.publicKey,
      path: "m/84'/0'/0'/0/0",
    }],
  });
  const psbt = Psbt.fromBase64(result.base64);

  expect(psbt.data.inputs[0].bip32Derivation).toEqual([{
    masterFingerprint: Buffer.from('d34db33f', 'hex'),
    pubkey: signer.publicKey,
    path: "m/84'/0'/0'/0/0",
  }]);
});

test('binds a standard multisig script to its P2WSH address', () => {
  const policy = payments.p2ms({ m: 2, pubkeys: MULTISIG_PUBKEYS, network: networks.bitcoin });
  const wallet = payments.p2wsh({ redeem: policy, network: networks.bitcoin });
  const result = buildBip322Psbt({
    address: wallet.address,
    message: MESSAGE,
    witnessScriptHex: policy.output.toString('hex'),
  });

  expect(getPsbtAddressType(wallet.address)).toBe('p2wsh');
  expect(result.multisig).toEqual({ requiredSignatures: 2, totalSigners: 2 });
});

test('rejects a multisig script that does not derive the claimed address', () => {
  const policy = payments.p2ms({ m: 2, pubkeys: MULTISIG_PUBKEYS, network: networks.bitcoin });
  const otherPolicy = payments.p2ms({ m: 1, pubkeys: MULTISIG_PUBKEYS, network: networks.bitcoin });
  const otherWallet = payments.p2wsh({ redeem: otherPolicy, network: networks.bitcoin });

  expect(() => buildBip322Psbt({
    address: otherWallet.address,
    message: MESSAGE,
    witnessScriptHex: policy.output.toString('hex'),
  })).toThrow('does not match');
});

test('produces a PSBT that can be signed and finalized by a single Native SegWit key', () => {
  const signer = privateKey(1);
  const wallet = payments.p2wpkh({ pubkey: signer.publicKey, network: networks.bitcoin });
  const proof = buildBip322Psbt({ address: wallet.address, message: MESSAGE });
  const signed = Psbt.fromBase64(proof.base64);

  signed.signInput(0, signer);

  expect(signed.validateSignaturesOfInput(0, validator)).toBe(true);
  expect(() => signed.finalizeInput(0)).not.toThrow();
  expect(signed.data.inputs[0].finalScriptWitness).toBeTruthy();
});

test('requires the configured multisig threshold before finalization', () => {
  const signers = [privateKey(1), privateKey(2), privateKey(3)];
  const policy = payments.p2ms({
    m: 2,
    pubkeys: signers.map((signer) => signer.publicKey),
    network: networks.bitcoin,
  });
  const wallet = payments.p2wsh({ redeem: policy, network: networks.bitcoin });
  const proof = buildBip322Psbt({
    address: wallet.address,
    message: MESSAGE,
    witnessScriptHex: policy.output.toString('hex'),
  });
  const signed = Psbt.fromBase64(proof.base64);

  signed.signInput(0, signers[0]);
  expect(() => signed.clone().finalizeInput(0)).toThrow();

  signed.signInput(0, signers[1]);
  expect(signed.validateSignaturesOfInput(0, validator)).toBe(true);
  expect(() => signed.finalizeInput(0)).not.toThrow();
  expect(signed.data.inputs[0].finalScriptWitness).toBeTruthy();
});
