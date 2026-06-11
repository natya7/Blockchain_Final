import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";

import "./App.css";
import { AUCTION_ABI, DEFAULT_AUCTION, DEFAULT_FACTORY, FACTORY_ABI, NFT_ABI, TOKEN_ABI } from "./contracts";
import { encryptAmount, publicDecryptPair, userDecryptHandle } from "./fhevm";

const SEPOLIA_CHAIN_ID = 11155111n;
const PHASES = ["Created", "Open", "Settling", "Settled"];

type Status = {
  phase: number;
  deadline: number;
  bidCount: number;
  reservePrice: bigint;
  tokenAddress: string;
  hasBid: boolean;
  winner: string;
  clearingPrice: bigint;
  claimed: boolean;
  highestBidHandle: string;
  secondHighestBidHandle: string;
  highestBidderHandle: string;
  escrowHandle: string;
  balanceHandle: string;
};

function App() {
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [account, setAccount] = useState("");
  const [wrongChain, setWrongChain] = useState(false);
  const [auctionAddress, setAuctionAddress] = useState(DEFAULT_AUCTION);
  const [status, setStatus] = useState<Status | null>(null);
  const [observer, setObserver] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [myBalance, setMyBalance] = useState<bigint | null>(null);
  const [myEscrow, setMyEscrow] = useState<bigint | null>(null);
  const [now, setNow] = useState(0);
  const [factoryAddress, setFactoryAddress] = useState(DEFAULT_FACTORY);
  const [auctionList, setAuctionList] = useState<{ address: string; phase: number }[]>([]);
  const [mintedNftId, setMintedNftId] = useState<bigint | null>(null);
  const [createReserve, setCreateReserve] = useState("100");
  const [createMinutes, setCreateMinutes] = useState("60");

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  async function connect() {
    if (!window.ethereum) {
      setMessage("MetaMask not found");
      return;
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    setWrongChain(network.chainId !== SEPOLIA_CHAIN_ID);
    const s = await provider.getSigner();
    setSigner(s);
    setAccount(await s.getAddress());
  }

  const refresh = useCallback(async () => {
    if (!signer || !ethers.isAddress(auctionAddress)) {
      return;
    }
    try {
      const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
      const tokenAddress = await auction.token();
      const token = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
      const next: Status = {
        phase: Number(await auction.phase()),
        deadline: Number(await auction.deadline()),
        bidCount: Number(await auction.bidCount()),
        reservePrice: await auction.reservePrice(),
        tokenAddress,
        hasBid: await auction.hasBid(account),
        winner: await auction.winner(),
        clearingPrice: await auction.clearingPrice(),
        claimed: await auction.claimed(),
        highestBidHandle: await auction.highestBid(),
        secondHighestBidHandle: await auction.secondHighestBid(),
        highestBidderHandle: await auction.highestBidder(),
        escrowHandle: await auction.escrowOf(account),
        balanceHandle: await token.confidentialBalanceOf(account),
      };
      setStatus(next);
    } catch {
      setStatus(null);
      setMessage("could not load auction — check the address");
    }
  }, [signer, auctionAddress, account]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setMessage("");
    try {
      await action();
      setMessage(`${label} done`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setMessage(`${label} failed: ${reason.slice(0, 200)}`);
    } finally {
      setBusy("");
      refresh();
    }
  }

  const mint = () =>
    run("mint", async () => {
      const token = new ethers.Contract(status!.tokenAddress, TOKEN_ABI, signer);
      const tx = await token.mint();
      await tx.wait();
    });

  const decryptBalance = () =>
    run("decrypt balance", async () => {
      if (status!.balanceHandle === ethers.ZeroHash) {
        setMyBalance(0n);
        return;
      }
      setMyBalance(await userDecryptHandle(signer!, status!.tokenAddress, status!.balanceHandle));
    });

  const placeBid = () =>
    run("bid", async () => {
      const amount = BigInt(bidAmount);
      const token = new ethers.Contract(status!.tokenAddress, TOKEN_ABI, signer);
      const isOperator = await token.isOperator(account, auctionAddress);
      if (!isOperator) {
        const approveTx = await token.setOperator(auctionAddress, status!.deadline + 3600);
        await approveTx.wait();
      }
      const encrypted = await encryptAmount(auctionAddress, account, amount);
      const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
      const tx = await auction.bid(encrypted.handle, encrypted.proof);
      await tx.wait();
    });

  const decryptEscrow = () =>
    run("decrypt escrow", async () => {
      if (status!.escrowHandle === ethers.ZeroHash) {
        setMyEscrow(0n);
        return;
      }
      setMyEscrow(await userDecryptHandle(signer!, auctionAddress, status!.escrowHandle));
    });

  const finalize = () =>
    run("finalize", async () => {
      const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
      const tx = await auction.finalize();
      await tx.wait();
    });

  const settle = () =>
    run("settle", async () => {
      const decrypted = await publicDecryptPair([status!.highestBidderHandle, status!.secondHighestBidHandle]);
      const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
      const tx = await auction.settle(decrypted.cleartexts, decrypted.proof);
      await tx.wait();
    });

  const claim = () =>
    run("claim", async () => {
      const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
      const tx = await auction.claim();
      await tx.wait();
    });

  const withdraw = () =>
    run("withdraw", async () => {
      const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
      const tx = await auction.withdraw();
      await tx.wait();
    });

  const loadAuctions = useCallback(async () => {
    if (!signer || !ethers.isAddress(factoryAddress)) {
      setAuctionList([]);
      return;
    }
    try {
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, signer);
      const addresses: string[] = await factory.all();
      const withPhases = await Promise.all(
        addresses.map(async (address) => {
          const auction = new ethers.Contract(address, AUCTION_ABI, signer);
          return { address, phase: Number(await auction.phase()) };
        }),
      );
      setAuctionList(withPhases);
    } catch {
      setAuctionList([]);
    }
  }, [signer, factoryAddress]);

  useEffect(() => {
    loadAuctions();
  }, [loadAuctions]);

  async function getNftAddress() {
    const auction = new ethers.Contract(auctionAddress, AUCTION_ABI, signer);
    return auction.nft() as Promise<string>;
  }

  const mintNft = () =>
    run("mint nft", async () => {
      const nftAddress = await getNftAddress();
      const nft = new ethers.Contract(nftAddress, NFT_ABI, signer);
      const tx = await nft.mint();
      const receipt = await tx.wait();
      const log = receipt.logs.find(
        (l: ethers.Log) => l.address.toLowerCase() === nftAddress.toLowerCase(),
      );
      const parsed = nft.interface.parseLog(log);
      setMintedNftId(parsed!.args.tokenId);
    });

  const createAuction = () =>
    run("create auction", async () => {
      if (mintedNftId === null) {
        throw new Error("mint a prize nft first");
      }
      const nftAddress = await getNftAddress();
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, signer);
      const biddingTime = BigInt(createMinutes) * 60n;
      const createTx = await factory.createAuction(nftAddress, mintedNftId, BigInt(createReserve), biddingTime);
      const receipt = await createTx.wait();
      const log = receipt.logs.find(
        (l: ethers.Log) => l.address.toLowerCase() === factoryAddress.toLowerCase(),
      );
      const parsed = factory.interface.parseLog(log);
      const newAuction = parsed!.args.auction as string;

      const nft = new ethers.Contract(nftAddress, NFT_ABI, signer);
      await (await nft.approve(newAuction, mintedNftId)).wait();
      const auction = new ethers.Contract(newAuction, AUCTION_ABI, signer);
      await (await auction.start()).wait();

      setMintedNftId(null);
      setAuctionAddress(newAuction);
      loadAuctions();
    });

  const secondsLeft = status ? status.deadline - now : 0;
  const isWinner = status && account && status.winner.toLowerCase() === account.toLowerCase();

  return (
    <div className="page">
      <header className="masthead">
        <div className="mast-brand">
          <span className="seal" aria-hidden="true">
            V
          </span>
          <div>
            <h1>Sealed-Bid Vickrey Auction</h1>
            <p className="subtitle">encrypted bids on Zama fhEVM · Sepolia</p>
          </div>
        </div>
        {signer ? (
          <span className="account">
            {account.slice(0, 6)}…{account.slice(-4)}
          </span>
        ) : (
          <button className="primary" onClick={connect}>
            Connect wallet
          </button>
        )}
      </header>

      {wrongChain && <div className="warning">switch MetaMask to Sepolia and reload</div>}

      {signer && (
        <>
          <div className="card">
            <label>
              auction address
              <input value={auctionAddress} onChange={(e) => setAuctionAddress(e.target.value.trim())} />
            </label>
            <label>
              factory address (optional — to create or browse auctions)
              <input value={factoryAddress} onChange={(e) => setFactoryAddress(e.target.value.trim())} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={observer} onChange={(e) => setObserver(e.target.checked)} />
              observer mode — see the auction as an outsider
            </label>
          </div>

          {!observer && auctionList.length > 0 && (
            <div className="card">
              <h3>auctions on this factory</h3>
              {auctionList.map((a) => (
                <div key={a.address} className="row">
                  <button disabled={!!busy} onClick={() => setAuctionAddress(a.address)}>
                    load
                  </button>
                  <code>{a.address}</code>
                  <span className="note">{PHASES[a.phase]}</span>
                </div>
              ))}
            </div>
          )}

          {!observer && ethers.isAddress(factoryAddress) && status && (
            <div className="card">
              <h3>run your own auction</h3>
              <div className="row">
                <button disabled={!!busy} onClick={mintNft}>
                  mint a prize nft
                </button>
                {mintedNftId !== null && <span className="note">nft #{mintedNftId.toString()} ready</span>}
              </div>
              <div className="row">
                <label>
                  reserve
                  <input value={createReserve} onChange={(e) => setCreateReserve(e.target.value.trim())} />
                </label>
                <label>
                  minutes
                  <input value={createMinutes} onChange={(e) => setCreateMinutes(e.target.value.trim())} />
                </label>
                <button className="primary" disabled={!!busy || mintedNftId === null} onClick={createAuction}>
                  create and start
                </button>
              </div>
              <p className="note">creates an auction with you as seller, escrows the nft, opens bidding</p>
            </div>
          )}

          {status && (
            <div className="card status-card">
              <span className="eyebrow">Auction status</span>
              <h2>{PHASES[status.phase]}</h2>
              <p className="stat-line">
                <span>
                  <b>{status.bidCount}</b> bids
                </span>
                <span className="dot">·</span>
                <span>
                  reserve <b>{status.reservePrice.toString()}</b>
                </span>
                {status.phase === 1 && now > 0 && (
                  <>
                    <span className="dot">·</span>
                    <span className="countdown">
                      {secondsLeft > 0 ? (
                        <>
                          ends in <b>{secondsLeft}s</b>
                        </>
                      ) : (
                        "bidding over"
                      )}
                    </span>
                  </>
                )}
              </p>
              {status.phase === 3 && (
                <div className="results">
                  <p>
                    winner: <b>{status.winner === ethers.ZeroAddress ? "nobody (reserve not met)" : status.winner}</b>
                  </p>
                  {status.winner !== ethers.ZeroAddress && (
                    <p>
                      clearing price (2nd highest bid): <b>{status.clearingPrice.toString()}</b>
                    </p>
                  )}
                  <p className="note">the winning bid amount itself stays encrypted forever</p>
                </div>
              )}
            </div>
          )}

          {status && observer && (
            <div className="card observer">
              <h3>what an observer sees</h3>
              <p>
                highest bid: <code>{status.highestBidHandle}</code>
              </p>
              <p>
                second highest: <code>{status.secondHighestBidHandle}</code>
              </p>
              <p>
                leading bidder: <code>{status.highestBidderHandle}</code>
              </p>
              <p className="note">
                these are ciphertext handles — the chain stores no readable amounts. an observer learns only who
                transacted and when.
              </p>
            </div>
          )}

          {status && !observer && (
            <>
              <div className="card">
                <h3>my tokens</h3>
                <div className="row">
                  <button disabled={!!busy} onClick={mint}>
                    mint 1000
                  </button>
                  <button disabled={!!busy} onClick={decryptBalance}>
                    decrypt my balance
                  </button>
                  {myBalance !== null && <span className="value">{myBalance.toString()}</span>}
                </div>
              </div>

              <div className="card">
                <h3>my bid</h3>
                {status.phase === 1 && !status.hasBid && secondsLeft > 0 && (
                  <div className="row">
                    <input
                      placeholder="amount"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value.trim())}
                    />
                    <button className="primary" disabled={!!busy || !bidAmount} onClick={placeBid}>
                      place encrypted bid
                    </button>
                  </div>
                )}
                {status.hasBid && (
                  <div className="row">
                    <button disabled={!!busy} onClick={decryptEscrow}>
                      decrypt my escrow
                    </button>
                    {myEscrow !== null && <span className="value">{myEscrow.toString()}</span>}
                  </div>
                )}
                {status.phase === 3 && isWinner && !status.claimed && (
                  <button className="primary" disabled={!!busy} onClick={claim}>
                    claim nft and refund
                  </button>
                )}
                {status.phase === 3 && status.hasBid && !isWinner && (
                  <button disabled={!!busy} onClick={withdraw}>
                    withdraw my escrow
                  </button>
                )}
              </div>

              <div className="card">
                <h3>lifecycle</h3>
                <div className="row">
                  <button disabled={!!busy || status.phase !== 1 || secondsLeft > 0} onClick={finalize}>
                    finalize
                  </button>
                  <button disabled={!!busy || status.phase !== 2} onClick={settle}>
                    settle
                  </button>
                </div>
                <p className="note">anyone can run these — settlement reveals only the winner and the price</p>
              </div>
            </>
          )}

          {busy && <div className="status">working: {busy}…</div>}
          {message && <div className="status">{message}</div>}
        </>
      )}
    </div>
  );
}

export default App;
