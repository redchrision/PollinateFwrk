const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
// const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { deployTokenAndLp } = require('./general.js');

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [owner, otherAccount] = await ethers.getSigners();

  const PeriodicDispatcher = await ethers.getContractFactory("PeriodicDispatcher");
  const pd = await PeriodicDispatcher.deploy();
  console.log("PeriodicDispatcher is:", await pd.getAddress());

  const MockPeriodic = await ethers.getContractFactory("MockPeriodic");
  const mockPeriodic = await MockPeriodic.deploy(await pd.getAddress());

  // Only for the MockToken
  const PayAfterDispatcher = await ethers.getContractFactory("PayAfterDispatcher");
  const pad = await PayAfterDispatcher.deploy();

  const {
    uniswapV2Router02,
    uniswapV2Factory,
    mockWETH,
    lpTokenAddress,
    mockToken,
    uniswapV2Helper
  } = await deployTokenAndLp(pad, ethers.parseEther('50'), ethers.parseEther('50'));

  const SneezeMine = await ethers.getContractFactory("MockSneezeMine");
  const sneezeMine = await SneezeMine.deploy(
    await mockToken.getAddress(),
    await uniswapV2Router02.getAddress(),
    await pd.getAddress(),
  );

  mockToken.transfer(await sneezeMine.getAddress(), mockToken.balanceOf(await owner.getAddress()));

  return { owner, otherAccount, pd, mockPeriodic, sneezeMine };
}

describe("PeriodicDispatcher", function () {
  describe("Periodic", function () {
    it("Can dispatch", async function () {
      const { owner, otherAccount, pd, mockPeriodic, sneezeMine } = await loadFixture(deploy);
      console.log("otherAccount address: ", (await otherAccount.getAddress()).toLowerCase());

      // Need some time to pass
      const timeToIncrease = 600;
      await ethers.provider.send("evm_increaseTime", [timeToIncrease]);
      await ethers.provider.send("evm_mine", []); // Mine a new block to apply the time change

      const tx = await pd.dispatch(await sneezeMine.getAddress(), 0);
      // console.log(tx);
      await tx.wait();
    });
  });
});
