# Pollinate

Flowers need to exchange pollen in order to fruit, but they are unable to move on their own so they
enlist the help of bees by offering nectar as a reward.

Likewise, smart contracts are unable to run themselves, so with the Pollinate Framework, they can
enlist the help of *pollinators* by offering them rewards in the network's base token.

The pollinate framework has two main components:

* Periodic - For smart contracts which need to be called on a periodic basis
* PayAfter - For allowing users to pay the cost of a transaction with the proceeds of that transaction.

## Periodic
This is for contracts which need to periodically perform some background task such as paying out
stakers, or collecting a data sample for a moving average. Payment to the pollinators works similarly
to crypto mining difficulty, except rather than an adjusting difficulty there is an adjusting payout.
The available payout ("nectar") builds up until it becomes worthwhile for a pollinator to call the
periodic function and collect it.

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
        50000 * GEWI * 2               // _initialPayPerPeriod
    ) { }
    function periodic() external override {
        counter++;
    }
    // Add a default receiver which adds the coins as nectar
    receive() external payable {
        IPeriodicDispatcher(periodicDispatcher()).addNectar{ value: msg.value }(address(this));
    }
}
```

The three arguments you must provide to the `Periodic()` constructor:
* `uint64 _targetSecondsPerCycle`: Target seconds between cycles (example uses 10 minutes)
* `uint64 _cyclesPerRetarget`: Number of calls per re-target (example uses 100, ~17 hours)
* `uint _initialPayPerPeriod`: Initial payout per cycle time. Because the retarget will not
come until `_cyclesPerRetarget` actual calls have occurred, you generally want to err on the
side of generosity. The retargetting algorithm will re-adjust to seek the correct cycle rate.
However, each retarget event will only (at maximum) halve the nectar payout rate, so if your
initial payout is *too* generous, it will take a number of retargets before it has cut back to
the right amount.

In the example, we estimate the gas consumption of
`PeriodicDispatcher.dispatch(ourContractAddress)`, multiply that by the gas price, and then
multiply by 2 for a safety margin.

Then you need to implement the `periodic()` function. This function must tollerate being
called by anyone at any time. It may be called more often or less often than the specified
period.

**WARNING:** You may be tempted to forbid calling `periodic()` unless the requisite amount
of time has passed, for example `require(block.timestamp >= targetTimePerCycle)`. You *must*
allow cycling at a faster rate than the target. Failure to do so will make the retargetting
logic think it needs to increase the nectar payout all of the time.

If you have a pre-existing contract and you would like to offload the job of calling its
periodic maintanence function, you may easily write a new `Periodic` contract which calls
it. Once you are done, just send some tokens to `PeriodicDispatcher.addNectar()` to fund
the periodic calling of your contract.

### Advanced Periodic
If you are writing a contract which should sell its own tokens in order to fund its periodic
function, you can do this as well. An example is given in
`./contracts/sneezetoken/SneezeMine.sol`. Inside of the `periodic()` function we call
`nectarShortfall()` which is provided by `Periodic`. The `nectarShortfall()` function
tells us how much we need to send to the periodic dispatcher in order to fund the transaction.

If the periodic is already well funded, as in out above example with the developer calling
`addNectar()`, `nectarShortfall()` will return zero, but if we are out of funds,
`nectarShortfall()` will return the amount of funds that must be send to the
`PeriodicDispatcher` contract in order to make the transaction successful.

In this example, we use UniswapV2 to sell a portion of the yielded tokens in order to cover
the shortfall.

```solidity
// 2. find out how much additional the base token is needed
uint shortfall = nectarShortfall();

address[] memory path = new address[](2);
path[0] = address(sneeze);
path[1] = sneezeMarket.WETH();

// 3. Auth the sneeze market to use up to amt
sneeze.approve(address(sneezeMarket), amt);

// 4. Swap to get that amount of the base token -> payto the dispatcher
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
    calls: string[],
    fees: number | Object[]
): Promise<bigint>;
function makeFee(amount: bigint): Object;
function makeInvalid(): Object;
async function signCalls(signer: ethers.Signer, calls: string, fees: Object[]): Promise<string>;
function getDispatcher(provider: ethers.Provider, address?: string): ethers.Contract;
function getUniswapV2Helper(provider: ethers.Provider, address?: string): ethers.Contract;
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
    await prepareCall(myErc20Token, "transfer", ['0x1234addressofyourfriend', ethers.parseEther('1')]),
];
```

##### estimateGas()
Once you have prepared your list of function calls, you will want to estimate the gas requirement for
those functions. For this you use the `estimateGas()` function call. Because each fee policy entry
adds about 5,000 gas cost, you should know in advance how many fee policy entries you plan to have,
but you do not need to know what they are yet.

The arguments to `estimateGas()` are as follows:
* `signer`: The `ethers.js` signer object, you will not be asked to sign anything.
* `calls`: An array of calls as made by `prepareCall()`
* `fees`: This can be either the number of Fee Entries which you plan to use, or it can be an array of
the actual Fee Entries if you know them already.

Example:

```javascript
const calls = [
    await prepareCall(mockCallable, "callMeMaybe", [123]),
    await prepareCall(mockCallable, "callMeMaybe", [456]),
];
console.log('Gas: ', await estimateGas(owner, calls, 3));
```

##### makeFee()
The Pollinate fee policy is made up of a list of Fee Entries, each of which is created by `makeFee()`.
To use `makeFee()` you must specify the amount of the fee (in Wei), and when (relative to the contract's
creation) that fee will be in effect. Time is specified using `.after(n).<time unit>`.

To set the fee to 100 Wei after the transaction has spend 3 minutes without being confirmed, you
would do the following:

```javascript
makeFee(BigInt(100)).after(3).minutes
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
than 127 time units. So for example `.after(128).seconds` is invalid and you must use
`.after(2).minutes` instead.

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

1. If a transaction does not clear in a timely manner you will probably need to make another one,
and then if the original transaction finally lands weeks or months later, someone might be getting
paid twice what they expected to.
2. To prevent transactions being confirmed more than once, the `PayAfterDispatcher` remembers
every transaction that it ever performed. Adding memory of a transaction adds 20,000 gas to each
transaction. However, once a transaction is provably invalid, it can be removed from storage
bringing a 15,000 gas refund. Identification and removal of expired entries is handled entirely by
the pollinators, but they are only able to remove an entry while performing another transaction by
the *same* signer, so adding a `makeInvalid()` to your transaction will make your future
transactions cheaper for pollinators to submit, making them get executed faster and at a lower fee.

```javascript
// Offer to pay 10 Wei, but after 2 minutes increase that to 100 Wei.
// If no pollinator submits the transaction for 10 minutes, make it invalid.
const fees = [
    makeFee(10n),
    makeFee(100n).after(2).minutes,
    makeInvalid().after(10).minutes,
];
```

##### signCalls()
Once you have structured your transaction and fee policy, you can now sign it. This function call
will open the user's wallet and ask them to sign binary data. To sign, you need the signer object,
the list of calls, and the completed fee policy. The output of this function is a hex binary string
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
`PayAfterDispatcher` so that the dispatcher can pay the fee. You can do this with any contract that
calls `PayAfterDispatcher.getRequiredFee()` and then pays that amount of base token to the
dispatcher. For `ERC20PayAfter` users, there is a `UniswapV2Helper` which does this by by selling
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
3. Create your fee policy
4. Sign and submit the transaction

```javascript
// Expecting you to have `ethers`, `signer`, and `provider`.
const {
    getUniswapV2Helper,
    prepareCall,
    estimateGas,
    makeFee,
    makeInvalid,
    signCalls
} = require('pollinate').PayAfter;
const sendToAddress = '0x0000000000000000000000000000000000000000'; // TODO: Fill in a real address
const sendAmount = ethers.parseEther('100'); // number of tokens
const myToken = '0x0000000000000000000000000000000000000000'; // TODO: Fill in a real token address
const calls = [];
const uniswapV2Helper = getUniswapV2Helper(provider);

calls.push(await prepareCall(myToken, "transfer", [sendToAddress, sendAmount]));
const allow = myToken.allowance(await signer.getAddress(), await uniswapV2Helper.getAddress());
if (allow < ethers.MaxUint256) {
    // If we've already approved the uniswapV2Helper, we can skip this and save gas
    calls.push(await prepareCall(myToken, "approve", [await uniswapV2Helper.getAddress(), ethers.MaxUint256]));
}
calls.push(await prepareCall(uniswapV2Helper, "coverFee", [await myToken.getAddress()]));

const gas = await estimateGas(ethers.provider, await signer.getAddress(), calls, 5);
const feeData = await ethers.provider.getFeeData();
const baseFeePerGas = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;

const fees = [
    makeFee(baseFeePerGas*gas),
    makeFee(feeData.maxFeePerGas*gas).after(10).seconds,
    makeFee(feeData.maxFeePerGas*gas*3n/2n).after(30).seconds,
    makeFee(feeData.maxFeePerGas*gas*4n).after(5).minutes,
    makeInvalid().after(10).minutes,
];

const signedData = await signCalls(signer, calls, fees);
```

### Periodic Fee Policy Specifics
The Fee Entries created by `makeFee()` have a few additional methods that may
be useful. A Fee Entry is packed in 32 bits of data. To do this, the fee
amount is rounded and represented similarly to a floating-point number. The
time specification is *not* rounded, but the times that you can specify are
restricted to 1-127 time-units.

```javascript
///  0               1               2               3
///  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
/// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
/// |L| TU  |   Fee Time  |    Fee Exp    |        Fee Base         |
/// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
///
/// * L           -> 1 if this is the last fee entry
/// * TU          -> Time Unit (second, minute, hour, day, week, month, year, tensec)
/// * Fee Time    -> After this number of time units, this fee will apply
/// * Fee Exp     -> Fee amount exponent
/// * Fee Base    -> Fee amount base (fee = base << exponent)
```

### timeSeconds()
Calling `fee.timeSeconds()` will give you the number of seconds that this
time specification. Remember fee times are based on the time the transaction
was signed.

### amtRounded()
This function gives you the precise amount of the specified fee (rounded to
fit in 13 bits). The following example shows that 1 ETN (`10 ** 18`) is not a
round number in binary, so it is rounded.

```javascript
let hh = require('hardhat');
let p = require('./dist/pollinate.js');
hh.ethers.formatEther(p.PayAfter.makeFee(hh.ethers.parseEther('1')).amtRounded())
```

This prints `0.99993985476460544`.

### toBinary(last: boolean)
This outputs the binary representation of a fee entry, you probably won't
need it but it might be useful for understanding how fees work.

```javascript
> p.PayAfter.makeFee(hh.ethers.parseEther('1')).toBinary(false).toString('2').padStart(32,'0')
'00000000000001011111101111000001'
> p.PayAfter.makeFee(hh.ethers.parseEther('1')).toBinary(true).toString('2').padStart(32,'0')
'10000000000001011111101111000001'
```

## Pollinator API
The pollinator daemon has an HTTP API that allows you to submit a PayAfter and allows you to
track your PayAfters given your address.

### PayAfter Transaction Lifecycle

When a PayAfter transaction is submitted to a pollinator, it will either fail it immediately
with an error, try to execute it (send it to the chain) immediately, or it will hold it
waiting for the fee rate to become more advantageous.

```
Submitted --------> Error
   |   |             ^
   |   |             |
   |   |             |
   |   +--------> Waiting
   |                 |
   |                 |
   |                 v
   +-----------> Executed
```

### POST /api/v1/payafter
#### Request

```js
{
    // The hex encoded transaction output from signCalls
    "txn": "0x01020304..."
}
```

#### Response1, parse error

```js
{
    "error": [
        "Array of strings",
        "Representing the cause of the error"
    ]
}
```

#### Response 2, transaction error

```js
{
    // The signature hash of the signed calls
    "data_hash": "0x00010203..",
    // The creation time of the provided signed calls, seconds since the epoch
    "create_time": 12345678,
    "error": [
        "Array of strings",
        "Representing the cause of the error"
    ]
}
```

#### Response 3, waiting
This response means the pollinator is waiting until the fee rate goes up
to an amount that is enough to be worth transacting.

```js
{
    // The signature hash of the signed calls
    "data_hash": "0x00010203..",
    // The creation time of the provided signed calls, seconds since the epoch
    "create_time": 12345678,
    // When the pollinator will revisit the transaction, seconds since the epoch
    "wait_until": 9012345,
}
```

#### Response 4, executed
This response means the pollinator decided to submit the transaction
immediately.

```js
{
    // The signature hash of the signed calls
    "data_hash": "0x00010203..",
    // The creation time of the provided signed calls, seconds since the epoch
    "create_time": 12345678,
    // The on-chain transaction ID
    "txid": "0x00010203..",
}
```

### GET /api/v1/address-payafters/{address}
Find out what PayAfter transactions exist in the pollinator's system.

#### Response
The response is an array of transactions in any of the above mentioned except for
"early" errors which are always returned synchronously. Once the pollinator has
confirmed once that the transaction is "real" and it may be paid to run it, it
will be stored and then show up in this list.

```js
[
    // A transaction which experienced a transacting error
    {
        // The signature hash of the signed calls
        "data_hash": "0x00010203..",
        // The creation time of the provided signed calls, seconds since the epoch
        "create_time": 12345678,
        "error": [
            "Array of strings",
            "Representing the cause of the error"
        ]
    },

    // A transaction which is waiting
    {
        // The signature hash of the signed calls
        "data_hash": "0x00010203..",
        // The creation time of the provided signed calls, seconds since the epoch
        "create_time": 12345678,
        // When the pollinator will revisit the transaction, seconds since the epoch
        "wait_until": 9012345,
    },

    // A transaction which has been submitted
    {
        // The signature hash of the signed calls
        "data_hash": "0x00010203..",
        // The creation time of the provided signed calls, seconds since the epoch
        "create_time": 12345678,
        // The on-chain transaction ID
        "txid": "0x00010203..",
    }
]
```

## Running a pollinator
To run a pollinator, you must build the pollinator daemon.

1. Make sure you have Rust installed
        `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2. Build the pollinator code
        `cargo build --release`
3. Create a new configuration file
        `./target/release/pollinate genconf > ./config.yaml`
4. Edit the configuration file and set the RPC server to a private high throughput RPC
5. Launch the pollinator
        `./target/release/pollinate serve ./config.yaml`

When you launch the pollinator, you will be prompted for a passphrase, you can use
anything, but the passphrase you use + the seed words in the config file determine
your pollinator's ETN address / key.

Once your pollinator is alive, it will print it's address, send it some ETN so that
it can pay fees and it's off and running!

## Running the example Sneeze Wallet
1. Start a pollinator on your local machine on port 8080 (this is hardcoded in
the example `main.js`)
2. Launch the mini-server
    `node ./example/serve.js`
3. Navigate your browser to http://127.0.0.1:3000
