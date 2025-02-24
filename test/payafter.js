const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
// const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { prepareCall, signCalls, estimateGasCustom, makeFee, makeInvalid } = require('../dist/pollinate.js').PayAfter;
const { deployTokenAndLp } = require('./general.js');

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [owner, otherAccount] = await ethers.getSigners();

  const PayAfterDispatcher = await ethers.getContractFactory("PayAfterDispatcher");
  const pad = await PayAfterDispatcher.deploy();
  console.log("Dispatcher is:", await pad.getAddress());

  const MockCallable = await ethers.getContractFactory("MockCallable");
  const mockCallable = await MockCallable.deploy(await pad.getAddress());

  return { owner, otherAccount, pad, mockCallable };
}

async function payafterTest (delaySeconds) {
  const { pad, mockCallable, owner, otherAccount } = await loadFixture(deploy);
  const {
    uniswapV2Router02,
    uniswapV2Factory,
    mockWETH,
    lpTokenAddress,
    mockToken,
    uniswapV2Helper
  } = await deployTokenAndLp(pad, ethers.parseEther('50'), ethers.parseEther('50'));

  // Send tokens to otherAddress
  await mockToken.transfer(await otherAccount.getAddress(), ethers.parseEther('10000'));

  console.log("Owner is:", await owner.getAddress());
  console.log("OtherAccount is:", await otherAccount.getAddress());
  console.log('OtherAccount Token Balance:',
      ethers.formatEther(await mockToken.balanceOf(await otherAccount.getAddress())));

  // Setup the calls
  const calls = [];
  calls.push(await prepareCall(
    mockToken, "transfer", [await owner.getAddress(), ethers.parseEther('50')]));
  const allow = await mockToken.allowance(await otherAccount.getAddress(), await uniswapV2Helper.getAddress());
  if (allow < ethers.MaxUint256) {
    calls.push(await prepareCall(
      mockToken, "approve", [await uniswapV2Helper.getAddress(), ethers.MaxUint256]));
  }
  calls.push(await prepareCall(uniswapV2Helper, "coverFee", [await mockToken.getAddress()]));

  // Pre-estimate the gas
  const gas = await estimateGasCustom(otherAccount, calls, 4, pad);
  console.log('Gas1:', gas);

  // Build the fee policy
  const fees = [
    makeFee(1n), // This will always cost the sender money
    makeFee(2n).after(10).hours, // This ensures that normal lag will not cause the fee to become significant
    makeFee(10n ** 18n).after(11).hours, // After 10.5 hours this transaction should be (wildly) profitable
    makeInvalid().after(20).hours, // After 20 hours, this transaction should be invalid
  ];

  // Re-check the gas
  console.log('Gas2:', await estimateGasCustom(otherAccount, calls, fees, pad));

  // Sign the calls
  let signed = await signCalls(otherAccount, calls, fees);

  if (delaySeconds > 0) {
    await ethers.provider.send("evm_increaseTime", [delaySeconds]);
    await ethers.provider.send("evm_mine", []); // Mine a new block to apply the time change
  }

  // Dispatch the calls (not the same account that signed them)
  const initialBalance = await ethers.provider.getBalance(owner.address);
  await pad.dispatch(signed, '0x');
  const endingBalance = await ethers.provider.getBalance(owner.address);
  return endingBalance - initialBalance;
}

describe("PayAfterDispatcher", function () {
  describe("PayAfter", function () {
    it("Can dispatch without fee", async function () {
      const { pad, mockCallable, owner, otherAccount } = await loadFixture(deploy);

      console.log("otherAccount address: ", (await otherAccount.getAddress()).toLowerCase());
      const calls = [
        await prepareCall(mockCallable, "callMeMaybe", [123]),
        await prepareCall(mockCallable, "callMeMaybe", [456]),
      ];

      const fees = [
        makeFee(0n),
        makeFee(10n).after(25).seconds,
        makeInvalid().after(10).minutes,
      ];

      console.log('Gas: ', await estimateGasCustom(otherAccount, calls, fees, pad));

      let signed = await signCalls(otherAccount, calls, fees);
  
      await pad.dispatch(signed, '0x');
      expect(await mockCallable.total()).to.equal(579);
      expect(await mockCallable.lastCaller()).to.equal(await otherAccount.getAddress());

      await expect(pad.dispatch(signed, '0x')).to.be.revertedWith("Already executed or killed");
    });

    it("Unprofitable transaction", async function () {
      const profit = await payafterTest(0);
      await expect(profit).to.be.lessThan(0n);
    });

    it("Profitable transaction", async function () {
      const profit = await payafterTest(3600 * 10.5);
      expect(profit).to.be.greaterThan(10n ** 18n / 2n);
      expect(profit).to.be.lessThan((10n ** 18n) * 3n / 4n);
    });

    it("Very profitable transaction", async function () {
      const profit = await payafterTest(3600 * 15);
      expect(profit).to.be.greaterThan((10n ** 18n) * 3n / 4n);
    });

    it("Expired transaction", async function () {
      await expect(payafterTest(3600 * 22)).to.be.revertedWith("Transaction has expired");
    });
  });
});
