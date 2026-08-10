import { describe, expect, it } from "vitest";
import { functionsOf, scanSolidity, stripComments } from "./solidity";

const TRAP = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract TrapToken {
    mapping(address => uint256) private _balances;
    mapping(address => bool) private _bots;
    bool public tradingEnabled;
    uint256 public sellFee = 3;
    address private _owner;

    modifier onlyOwner() { require(msg.sender == _owner); _; }
    modifier onlyDev() { require(msg.sender == 0x1234567890123456789012345678901234567890); _; }

    // selfdestruct(payable(msg.sender)); -- commented out, must NOT flag

    function renounceOwnership() public onlyOwner {
        emit OwnershipTransferred(_owner, address(0));
        // note: _owner is never actually cleared
    }

    function setSellFee(uint256 f) external onlyOwner {
        sellFee = f;
    }

    function openTrading() external onlyOwner { tradingEnabled = true; }
    function pauseTrading() external onlyDev { tradingEnabled = false; }

    function rescue(address who, uint256 amt) external onlyOwner {
        _balances[who] = amt;
    }

    function addBots(address[] calldata bots) external onlyOwner {
        for (uint i = 0; i < bots.length; i++) _bots[bots[i]] = true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(!_bots[from] && !_bots[to], "bot");
        require(tradingEnabled, "not open");
        _balances[from] -= amount;
        _balances[to] += amount;
    }

    event OwnershipTransferred(address indexed a, address indexed b);
}
`;

const CLEAN = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract CleanToken {
    mapping(address => uint256) private _balances;
    uint256 public constant TOTAL = 1e27;
    address private _owner;

    function renounceOwnership() public {
        require(msg.sender == _owner);
        _owner = address(0);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }
}
`;

describe("stripComments", () => {
  it("preserves line count and removes comments/strings", () => {
    const src = 'a // one\nb /* two\nthree */ c\nd "str//ing"';
    const out = stripComments(src);
    expect(out).toHaveLength(4);
    expect(out[0].trim()).toBe("a");
    expect(out[1].trim()).toBe("b");
    expect(out[2].trim()).toBe("c");
    expect(out[3]).toContain("''");
    expect(out[3]).not.toContain("str//ing");
  });
});

describe("functionsOf", () => {
  it("finds functions with gating info", () => {
    const fns = functionsOf(stripComments(TRAP));
    const names = fns.map((f) => f.name);
    expect(names).toContain("renounceOwnership");
    expect(names).toContain("rescue");
    expect(names).toContain("_transfer");
    const rescue = fns.find((f) => f.name === "rescue")!;
    expect(rescue.gated).toBe(true);
    const pause = fns.find((f) => f.name === "pauseTrading")!;
    expect(pause.customGate).toBe("onlyDev");
  });
});

describe("scanSolidity - trap contract", () => {
  const flags = scanSolidity([{ path: "TrapToken.sol", content: TRAP }]);
  const ids = flags.map((f) => f.id);

  it("detects the fake renounce", () => {
    expect(ids).toContain("fake-renounce");
  });
  it("detects the trading kill-switch", () => {
    expect(ids).toContain("trading-switch-off");
  });
  it("detects the owner balance rewrite", () => {
    const f = flags.find((x) => x.id === "owner-balance-write")!;
    expect(f).toBeTruthy();
    expect(f.detail).toContain("rescue");
  });
  it("detects the unbounded settable fee", () => {
    expect(ids).toContain("settable-fee-unbounded");
  });
  it("detects blacklist machinery used on transfers", () => {
    const f = flags.find((x) => x.id === "blacklist")!;
    expect(f).toBeTruthy();
    expect(f.detail).toMatch(/blocked from selling/);
  });
  it("detects the secondary privilege gate", () => {
    expect(ids).toContain("second-gate");
  });
  it("does NOT flag the commented-out selfdestruct", () => {
    expect(ids).not.toContain("selfdestruct");
  });
  it("anchors every flag to a real line", () => {
    const lines = TRAP.split("\n");
    for (const f of flags) {
      expect(f.line).toBeGreaterThan(0);
      expect(f.line).toBeLessThanOrEqual(lines.length);
      expect(f.excerpt.length).toBeGreaterThan(0);
    }
  });
});

describe("scanSolidity - clean contract", () => {
  const flags = scanSolidity([{ path: "CleanToken.sol", content: CLEAN }]);
  it("raises no critical or high flags", () => {
    expect(flags.filter((f) => f.severity === "critical" || f.severity === "high")).toHaveLength(0);
  });
  it("accepts a genuine renounce", () => {
    expect(flags.map((f) => f.id)).not.toContain("fake-renounce");
  });
});
