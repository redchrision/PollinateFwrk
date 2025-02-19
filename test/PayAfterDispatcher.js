const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
// const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { prepareCall, signCalls, estimateGasCustom, makeFee, makeInvalid } = require('../dist/pollinate').PayAfter;

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

async function deployUniswap() {
  const MockWETH = await ethers.getContractFactory("MockWETH");
  const mockWETH = await MockWETH.deploy();
  const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
  const uniswapV2Factory = await MockUniswapV2Factory.deploy(ZERO_ADDR);
  const UniswapV2Router01 = await ethers.getContractFactory("UniswapV2Router01");
  const uniswapV2Router02 = await UniswapV2Router01.deploy(
    await uniswapV2Factory.getAddress(),
    await mockWETH.getAddress(),
  );
  return { uniswapV2Router02, uniswapV2Factory, mockWETH };
}

async function deployTokenAndLp(pad, amountTokenToLp, amountEthToLp) {
  const MockToken = await ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy(await pad.getAddress());
  console.log("Mock Token:", await mockToken.getAddress());

  const { uniswapV2Router02, uniswapV2Factory, mockWETH } = await deployUniswap();

  mockToken.approve(await uniswapV2Router02.getAddress(), amountTokenToLp);

  await uniswapV2Router02.addLiquidityETH(
    await mockToken.getAddress(),
    amountTokenToLp,
    0n,
    0n,
    ZERO_ADDR,
    0xffffffffn,
    { value: amountEthToLp }
  );
  const lpTokenAddress =
      await uniswapV2Factory.getPair(await mockWETH.getAddress(), await mockToken.getAddress());
  console.log('LP Token:', lpTokenAddress);

  const UniswapV2Helper = await ethers.getContractFactory("UniswapV2Helper");
  const uniswapV2Helper = await UniswapV2Helper.deploy(
    await uniswapV2Router02.getAddress(),
    await pad.getAddress(),
  );

  return { uniswapV2Router02, uniswapV2Factory, mockWETH, lpTokenAddress, mockToken, uniswapV2Helper };
}

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

      await expect(pad.dispatch(signed, '0x')).to.be.revertedWith("Already executed");
    });

    it("Can pay it's own fee", async function () {
      const { pad, mockCallable, owner, otherAccount } = await loadFixture(deploy);
      const {
        uniswapV2Router02,
        uniswapV2Factory,
        mockWETH,
        lpTokenAddress,
        mockToken,
        uniswapV2Helper
      } = await deployTokenAndLp(pad, ethers.parseEther('1000000'), ethers.parseEther('1'));

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
      const feeData = await ethers.provider.getFeeData();
      const baseFeePerGas = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
      console.log(
        'Gas:', gas,
        'Fee1:', baseFeePerGas*gas,
        'Fee2:', feeData.maxFeePerGas*gas,
        'Fee3:', feeData.maxFeePerGas*gas*3n/2n,
      );

      // Build the fee policy
      const fees = [
        makeFee(baseFeePerGas*gas),
        makeFee(feeData.maxFeePerGas*gas).after(1).minute,
        makeFee(feeData.maxFeePerGas*gas*3n/2n).after(4).minutes,
        makeInvalid().after(10).minutes,
      ];

      // Re-check the gas
      console.log('Gas2:', await estimateGasCustom(otherAccount, calls, fees, pad));

      // Sign the calls
      let signed = await signCalls(otherAccount, calls, fees);

      // Dispatch the calls (not the same account that signed them)
      await pad.dispatch(signed, '0x');
    });
  });
});
