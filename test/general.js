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

module.exports.deployTokenAndLp = async (pad, amountTokenToLp, amountEthToLp) => {
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