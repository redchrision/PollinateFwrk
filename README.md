# Pollinate

Flowers need to exchange pollen in order to fruit, but they are unable to move on their own so they
enlist the help of bees by offering nectar as a reward.

Likewise, smart contracts are unable to run themselves, so with the Pollinate Framework, they can
enlist the help of pollinators by offering them rewards in the network's base token.

The pollinate framework has two main components:

* Periodic - For smart contracts which need to be called on a periodic basis
* PayAfter - For allowing users to pay the cost of a transaction with the proceeds of that transaction.

## Periodic
This is for contracts which need to periodically perform some background task such as paying out
stakers, or re-computing collecting a data sample for a moving average. Nectar generation rate works
similarly to crypto mining difficulty, except rather than an adjusting difficulty there is an
adjusting payout. The available payout ("nectar") builds up until it becomes worthwhile for a
pollinator to call the periodic function and collect it.

Every X number of calls (configurable) the periodic framework re-adjusts the amount of nectar that is
made available per second, decreasing it if the periodic function is getting called too often, and
increasing it if it is getting called too rarely.

To implement Periodic in your contract, you must extend the `Periodic` contract and provide the
necessary values to its constructor.

```solidity
contract ExamplePeriodic is Periodic {
    uint public counter;
    constructor() Periodic(
        60 * 10,                       // _targetSecondsPerCycle
        100,                           // _cyclesPerRetarget
        1 * 10**18 / uint(2726) / 10   // _initialPayPerPeriod
    ) { }
    function periodic() external override {
        counter++;
    }
}
```

The three arguments you must provide to the `Periodic()` constructor:
* `uint64 _targetSecondsPerCycle`: Target seconds between cycles (example uses 10 minutes)
* `uint64 _cyclesPerRetarget`: Number of calls per re-target (example uses 100, ~17 hours)
* `uint _initialPayPerPeriod`: Initial payout per cycle time. Because the retarget will not
come until `_cyclesPerRetarget` actual calls have occurred, you generally want to err on the
side of generosity. The retargetting algorithm will re-adjust to seek the correct cycle rate.
However, the algorithm will only (at maximum) halve the nectar payout rate, so if your
initial payout is *too* generous, it will take a number of retargets before it has cut back to
the right amount.

Then you need to implement the `periodic()` function. This function must tollerate being
called by anyone at any time. It may be called more often or less often than the specified
period.

**WARNING:** You may be tempted to forbid calling `periodic()` unless the requisite amount
of time has passed, for example `require(block.timestamp >= targetTimePerCycle)`. You *must*
allow cycling at a faster rate than the target. Failure to do so will make the retargetting
logic think it needs to increase the nectar payout all of the time.

If you have a pre-existing contract and you would like to offload the job of calling its
periodic maintanence function, you may easily write a new `Periodic` contract which calls
it. Once you are done, then you send some tokens to `PeriodicDispatcher.addNectar()` to
fund the periodic calling of your contract.

### Advanced Periodic
If you are writing a contract which should sell its own tokens in order to fund its periodic
function, you can do this as well. An example is given in
`./contracts/sneezetoken/SneezeMine.sol`. Inside of the `periodic()` function we call
`nectarShortfall()` which is provided by `Periodic`. The `nectarShortfall()` function
tells is how much we need to send to the periodic dispatcher in order to fund the transaction.

If the periodic is already well funded, as in out above example with the developer calling
`addNectar()`, `nectarShortfall()` will return zero, but if we are out of funds,
`nectarShortfall()` will return the amount of funds that must be send to the
`PeriodicDispatcher` contract in order to make the transaction successful.

In this example, we use UniswapV2 to sell a portion of the yielded tokens in order to cover
the shortfall.

```solidity
// 2. find out how much additional ETH is needed
uint shortfall = nectarShortfall();

address[] memory path = new address[](2);
path[0] = address(sneeze);
path[1] = sneezeMarket.WETH();

// 3. Auth the sneeze market to use up to amt
sneeze.approve(address(sneezeMarket), amt);

// 4. Swap to get that amount of ETH -> payto the dispatcher
if (shortfall > 0) {
    uint balance = sneeze.balanceOf(address(this));
    sneezeMarket.swapTokensForExactETH(shortfall, amt, path, periodicDispatcher(), block.timestamp);
    amt -= (balance - sneeze.balanceOf(address(this)));
}
```

## PayAfter
The PayAfter component offers the ability to pay the fee of a transaction using the proceeds
of that transaction. To use PayAfter, you create a signed binary representation of the
contract calls you intend to make, then you broadcast that to the Pollinate network where
pollinators pick it up and post it to the chain via the `PayAfterDispatcher` contract.

In order for the PayAfter transaction to actually pay for itself, one of the contract calls in
it must send some coins to the `PayAfterDispatcher` contract so that it can send them back to
pollinator who posted it.

### Writing contracts for PayAfter
When writing a contract to support PayAfter, you must be aware that all PayAfter transactions
will have the `PayAfterDispatcher` contract as their `msg.sender`.

You must not grant any kind of access or authority to the `PayAfterDispatcher` because anyone
can use it. However, a contract that is called by the `PayAfterDispatcher` can find out who
is the original creator of a transaction by calling `PayAfterDispatcher.getSigner()`. You can
also use the handy `PayAfter` library which offers a `msgSender()` function which checks if it's
being called by the `PayAfterDispatcher` and uses `PayAfterDispatcher.getSigner()` only if it is.

The `ERC20PayAfter` contract shows how PayAfter can be integrated in your contracts to make
them pay-after compatible.

```solidity
contract ERC20PayAfter is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    // Override Context in ERC20
    function _msgSender() override internal view returns (address) {
        return PayAfter.msgSender();
    }
}
```

Any token which extends `ERC20PayAfter` automatically supports PayAfter transactions.

### Using PayAfter
PayAfter allows you to structure a transaction and then send it to the pollinators for execution.
Transactions do *not* need to be ordered, so if you send two transactions at the same time, they
may land in either order.

PayAfter allows you to specify a custom fee / validity policy, you are able to specify a low fee
and then increase that fee if it takes a longer time for the transaction to be sent to the
blockchain. This creates a sort of "auction" where the fee can be slowly raised until there is a
pollinator who is willing to submit that transaction.

Fee policy can also be used to invalidate the transaction at some point in the future (assuming
it did not land before then), or to make the transaction invalid until a point in the future, or
both.

#### PayAfter Functions

Inside of `./lib/PayAfter.js` there are the following functions:

```typescript
async function prepareCall(contract: ethers.Contract, funcName: string, args: any[]): Promise<string>;
async function estimateGas(
    provider: ethers.Provider,
    signerAddress: string,
    calls: string[],
    fees: number | Object[]
): Promise<bigint>;
function makeFee(amount: bigint): Object;
function makeInvalid(): Object;
async function signCalls(signer: ethers.Signer, calls: string, fees: Object[]): Promise<string>;
```

##### prepareCall()
The first function you will need to use is the `prepareCall()` function. The `prepareCall()` function
takes a smart contract interaction and converts it into a hex string which represents a binary form of
the function call. The arguments are:

* `contract`: An `ethers.js` Contract object
* `funcName`: The name of the function in the contract to call
* `args`: The arguments to the functionc all, as though you were calling it with `ethers.js`

Example:

```javascript
const calls = [
    await prepareCall(myErc20Token, "transfer", ['0x1234addressofyourfriend', ethers.toWei('100')]),
];
```

##### estimateGas()
Once you have prepared your list of function calls, you will want to estimate the gas requirement for
those functions. For this you use the `estimateGas()` function call. Because each fee policy entry
adds about 5,000 gas cost, you should know in advance how many fee policy entries you will have, but
you do not need to know what they are yet.

The arguments to `estimateGas()` are as follows:
* `provider`: The `ethers.js` provider object, you do not need a signer.
* `signerAddress`: The address of the signer, in order to simulate how the transaction will actually
execute, `estimateGas()` needs to know who will be the signer.
* `calls`: An array of calls as made by `prepareCall()`
* `fees`: This can be either the number of Fee Entries which you plan to use, or it can be an array of
the actual Fee Entries.

Example:

```javascript
const calls = [
    await prepareCall(mockCallable, "callMeMaybe", [123]),
    await prepareCall(mockCallable, "callMeMaybe", [456]),
];
console.log('Gas: ', await estimateGas(ethers.provider, await otherAccount.getAddress(), calls, 3));
```

##### makeFee()
The Pollinate fee policy is made up of a list of Fee Entries, each of which is created by `makeFee()`.
To use `makeFee()` you must specify the amount of the fee (in Wei), and when (relative to the contract's
creation) that fee will be in effect. Time is specified using `.after(n).<time unit>`.

To set the fee to 100 Wei after the transaction has spend 3 minutes without being confirmed, you
would do the following:

```javascript
makeFee(100n).after(3).minutes
```

The valid time units are:
* `second` / `seconds`
* `minute` / `minutes`
* `hour` / `hours`
* `day` / `days`
* `week` / `weeks`
* `month` / `months`
* `year` / `years`

The space-saving binary representation of fees does not allow you to specify a timespan of more
than 127 time units. So for example `.after(128).seconds` is invalid, you must use `.after(2).minutes`
instead.

If `makeFee()` is used without a time specification, it is interpreted as "0 seconds since creation",
for example:

```javascript
// Offer to pay 10 Wei, but after 2 minutes increase that to 100 Wei.
const fees = [
    makeFee(10n),
    makeFee(100n).after(2).minutes,
];
```

If there is a span of time before the first fee specification, it means the transaction does not
become valid until that point in time. For example:

```javascript
// The transaction only becomes valid 1 minute after it's creation and pays a 10 Wei fee.
// After another minute the fee goes up to 100 Wei.
const fees = [
    makeFee(10n).after(1).minute,
    makeFee(100n).after(2).minutes,
];
```

##### makeInvalid()
If your transaction *never* gets confirmed on chain, you can use a special Fee Entry to invalidate
it entirely. This is really good practice for two reasons:

1. If a transaction does not clear in a timely mannor you will probably need to make another one,
and then if the original transaction finally lands weeks or months later, someone might be getting
paid twice what they expected to.
2. To prevent transactions being confirmed more than once, the PayAfter dispatcher remembers
every transaction that it ever performed. This adds 20,000 gas to each transaction. However, once a
transaction is provably invalid, it can be removed from storage which brings a 15,000 gas refund.
Identification and removal of expired entries is handled entirely by the pollinators, but they are
only able to remove an entry while performing another transaction by the same signer, so adding a
`makeInvalid()` to your transaction will make your future transactions cheaper for pollinators to
submit, making them get executed faster and at a lower fee.

```javascript
// Offer to pay 10 Wei, but after 2 minutes increase that to 100 Wei.
// If no pollinator submits the transaction for a day, make it invalid.
const fees = [
    makeFee(10n),
    makeFee(100n).after(2).minutes,
    makeInvalid().after(10).minutes,
];
```

##### signCalls()
Once you have structured your transaction and fee policy, you can now sign it. This function call
will open the user's wallet and ask them to sign binary data. To sign, you need the signer object,
the list of call, and the completed fee policy. The output of this function is a hex binary string
that can be sent to the pollinators.

Example:

```javascript
const calls = [
    await prepareCall(mockCallable, "callMeMaybe", [123]),
    await prepareCall(mockCallable, "callMeMaybe", [456]),
];
const fees = [
    makeFee(10n),
    makeFee(100n).after(2).minutes,
    makeInvalid().after(10).minutes,
];
const signedData = await signCalls(signer, calls, fees);
```

##### getUniswapV2Helper()
You may have noticed a problem with the `signCalls()`, we declared that we would be paying a fee,
but we didn't say where the coins would come from. Fees are funded by sending coins to the
`PayAfterDispatcher` contract, which then sends the necessary amount to the pollinator, and refunds
any remaining to the signer's address.

So in order for your PayAfter transaction to be valid, it must send enough coins to the
`PayAfterDispatcher` so that the dispatcher can pay the fee. How you do this is technically up to
you, but for `ERC20PayAfter` users, there is a `UniswapV2Helper` which can fund your fee by selling
some of your tokens.

```javascript
const uniswapV2Helper = getUniswapV2Helper(provider);
const calls = [];
calls.push(await prepareCall(myToken, "transfer", [sendToAddress, sendAmount]));

// Check if we need to approve() the uniswapV2Helper
const allow = myToken.allowance(await signer.getAddress(), await uniswapV2Helper.getAddress());
if (allow < ethers.MaxUint256) {
    calls.push(await prepareCall(myToken, "approve", [await uniswapV2Helper.getAddress(), ethers.MaxUint256]));
}

// Once approved, the helper will take what it needs to cover the declared fee
calls.push(await prepareCall(uniswapV2Helper, "coverFee", [await myToken.getAddress()]));
```

#### Pulling it all together
To structure a PayAfter transaction, you will generally want to:
1. Set up the calls
2. Estimate gas & access the current gas price to establish a base fee
3. Create the fee policy
4. Re-run estimate gas to check that the transaction is valid with fees
5. Sign and submit the transaction

```javascript
// Expecting you to have `ethers`, `signer`, and `provider`.
const { prepareCall, getUniswapV2Helper } = require('pollinate').PayAfter;
const sendToAddress = '0x0000000000000000000000000000000000000000'; // TODO: Fill in a real address
const sendAmount = ethers.toWei('100'); // number of tokens
const myToken = '0x0000000000000000000000000000000000000000'; // TODO: Fill in a real token address
const calls = [];
calls.push(await prepareCall(myToken, "transfer", [sendToAddress, sendAmount]));

const uniswapV2Helper = getUniswapV2Helper(provider);

const allow = myToken.allowance(await signer.getAddress(), await uniswapV2Helper.getAddress());
if (allow < ethers.MaxUint256) {
    calls.push(await prepareCall(myToken, "approve", [await uniswapV2Helper.getAddress(), ethers.MaxUint256]));
}

calls.push(await prepareCall(uniswapV2Helper, "coverFee", [await myToken.getAddress()]));

const gas = await estimateGas(ethers.provider, await signer.getAddress(), calls, 5);
const gasPrice = await provider.getGasPrice();
const baseFee = gas * gasPrice;

const fees = [
    makeFee(baseFee),
    makeFee(baseFee * 3n / 2n).after(1).minute,
    makeFee(baseFee * 2n).after(3).minutes,
    makeFee(baseFee * 3n).after(6).minutes,
    makeInvalid().after(10).minutes,
];

// Re-run estimateGas just to confirm that the transaction doesn't fail when it tries to pay its fees
await estimateGas(ethers.provider, await signer.getAddress(), calls, fees);

const signedData = await signCalls(signer, calls, fees);
```