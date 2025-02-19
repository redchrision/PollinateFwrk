const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
// const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [owner, otherAccount] = await ethers.getSigners();

  const PeriodicDispatcher = await ethers.getContractFactory("PeriodicDispatcher");
  const pd = await PeriodicDispatcher.deploy();
  console.log("PeriodicDispatcher is:", await pd.getAddress());

  const MockPeriodic = await ethers.getContractFactory("MockPeriodic");
  const mockPeriodic = await MockPeriodic.deploy(await pd.getAddress());

  return { owner, otherAccount, pd, mockPeriodic };
}

describe("PeriodicDispatcher", function () {
  describe("Periodic", function () {
    it("Can dispatch", async function () {
      const { owner, otherAccount, pd, mockPeriodic } = await loadFixture(deploy);
      console.log("otherAccount address: ", (await otherAccount.getAddress()).toLowerCase());

    });
  });
});
