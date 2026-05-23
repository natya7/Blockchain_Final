// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecretNumber is ZamaEthereumConfig {
    euint64 private number;

    function set(externalEuint64 encrypted, bytes calldata proof) external {
        number = FHE.fromExternal(encrypted, proof);
        FHE.allowThis(number);
        FHE.allow(number, msg.sender);
    }

    function addTo(externalEuint64 encrypted, bytes calldata proof) external {
        number = FHE.add(number, FHE.fromExternal(encrypted, proof));
        FHE.allowThis(number);
        FHE.allow(number, msg.sender);
    }

    function get() external view returns (euint64) {
        return number;
    }
}
