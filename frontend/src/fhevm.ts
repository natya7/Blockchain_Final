import { createInstance, initSDK, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { ethers } from "ethers";

let instance: FhevmInstance | null = null;

export async function getInstance(): Promise<FhevmInstance> {
  if (!instance) {
    if (!window.ethereum) {
      throw new Error("no wallet found");
    }
    await initSDK();
    instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });
  }
  return instance;
}

export async function encryptAmount(contract: string, user: string, amount: bigint) {
  const fhe = await getInstance();
  const input = fhe.createEncryptedInput(contract, user);
  input.add64(amount);
  const result = await input.encrypt();
  return {
    handle: ethers.hexlify(result.handles[0]),
    proof: ethers.hexlify(result.inputProof),
  };
}

export async function userDecryptHandle(
  signer: ethers.JsonRpcSigner,
  contract: string,
  handle: string,
): Promise<bigint> {
  const fhe = await getInstance();
  const keypair = fhe.generateKeypair();
  const start = Math.floor(Date.now() / 1000);
  const days = 1;
  const eip712 = fhe.createEIP712(keypair.publicKey, [contract], start, days);
  const signature = await signer.signTypedData(
    eip712.domain as ethers.TypedDataDomain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );
  const address = await signer.getAddress();
  const result = await fhe.userDecrypt(
    [{ handle, contractAddress: contract }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    [contract],
    address,
    start,
    days,
  );
  return result[handle as `0x${string}`] as bigint;
}

export async function publicDecryptPair(handles: string[]) {
  const fhe = await getInstance();
  const result = await fhe.publicDecrypt(handles);
  return { cleartexts: result.abiEncodedClearValues, proof: result.decryptionProof };
}
