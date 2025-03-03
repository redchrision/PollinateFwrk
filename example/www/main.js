import { ethers } from "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js";

const POLLINATOR = 'https://pollinate.cjdns.fr';
const SNEEZE = '0x9E5Ca6fdf143616b065e20d5B8ca4127e7d43CC6';

function log(msg) {
    console.log(msg);
}

function fail(msg) {
    console.log(msg);
    alert(msg);
}

let wallet = null;
let expectedFee = null;

async function connectWallet() {
    // Check if MetaMask is installed
    if (!window.ethereum) {
        fail('Please install MetaMask');
        return;
    }

    const erc20Res = await fetch("/erc20.json");
    const erc20 = await erc20Res.json();

    try {
        // Request account access
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (!accounts.length) {
            fail('No accounts found');
            return;
        }

        try {
            // Try to switch to the Base network
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: "0xcb2e" }],
            });
        } catch (switchError) {
            log(switchError.toString());
            fail('You need to have Electroneum chain enabled in your Web3 Wallet');
            return;
        }

        // Connect ethers.js to browser provider
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        console.log(signer);
        const address = signer.address
        log('Wallet Address: ' + address);

        // Get balance
        const balance = await provider.getBalance(address);
        const balanceEth = ethers.formatEther(balance);
        log('Balance: ' + balanceEth + ' ETN');

        wallet = Object.freeze({
            sneeze: new ethers.Contract(SNEEZE, erc20, signer),
            signer,
            provider,
            uniswapV2Helper: Pollinate.PayAfter.getUniswapV2Helper(provider),
        });

    } catch (error) {
        fail(error.stack);
    }
}

const FEE_POLICIES = {
    low: [
        [0.25, 0, 'seconds'],
        [1, 20, 'seconds'],
        [1.5, 60, 'seconds'],
        [10, 9, 'minutes'],
        [-1, 10, 'minutes'],
    ],
    normal: [
        [0.5, 0, 'seconds'],
        [1, 20, 'seconds'],
        [4, 60, 'seconds'],
        [10, 9, 'minutes'],
        [-1, 10, 'minutes'],
    ],
    high: [
        [1, 0, 'seconds'],
        [8, 30, 'seconds'],
        [10, 60, 'seconds'],
        [20, 9, 'minutes'],
        [-1, 10, 'minutes'],
    ]
};

const setFeePolicy = (choice) => {
    const elem = $('#advanced-options table tbody');
    elem.empty();
    for (let entry of FEE_POLICIES[choice]) {
        if (entry[0] > -1) {
            elem.append($(`
                <tr class="fee-entry fee-increase">
                    <td>Offer fee</td>
                    <td class="fee-mul">
                        <input type="text" size="3" value="${entry[0]}">
                        <span class="error-message"></span>
                    </td>
                    <td>times base estimate after</td>
                    <td class="fee-time">
                        <input type="number" size="3" min="1" max="127" value="${entry[1]}">
                        <span class="error-message"></span>
                    </td>
                    <td>
                        <select class="fee-tu">
                            ${['seconds','minutes','hours','days','weeks','months','years'].map((t) =>
                                `<option value="${t}"${t === entry[2] ? 'selected' : ''}>${t}</option>`
                            ).join('\n')}
                        </select>
                    </td>
                </tr>
                `));
        } else {
            elem.append($(`
                <tr class="fee-entry fee-inval">
                    <td colspan="3">Invalidate transaction if not confirmed after</td>
                    <td class="fee-time">
                        <input type="number" size="3" min="1" max="127" value="${entry[1]}">
                        <span class="error-message"></span>
                    </td>
                    <td>
                        <select class="fee-tu">
                            ${['seconds','minutes','hours','days','weeks','months','years'].map((t) =>
                                `<option value="${t}"${t === entry[2] ? 'selected' : ''}>${t}</option>`
                            ).join('\n')}
                        </select>
                    </td>
                </tr>
                `));
        }
    }
};

const createTransaction = async (to, amt, fees) => {
    const uha = await wallet.uniswapV2Helper.getAddress();
    const calls = [];
    calls.push(await Pollinate.PayAfter.prepareCall(wallet.sneeze, "transfer", [to, amt]));
    const allow = await wallet.sneeze.allowance(await wallet.signer.getAddress(), uha);
    if (allow < ethers.MaxUint256) {
        calls.push(await Pollinate.PayAfter.prepareCall(wallet.sneeze, "approve", [uha, ethers.MaxUint256]));
    }
    calls.push(await Pollinate.PayAfter.prepareCall(wallet.uniswapV2Helper, "coverFee", [SNEEZE]));

    let feeCheck = 5;
    if (fees) {
        feeCheck = fees;
    }

    const gas = await Pollinate.PayAfter.estimateGas(wallet.signer, calls, feeCheck);
    const feeData = await wallet.provider.getFeeData();

    if (!fees) {
        return Object.freeze({
            gas,
            feeData,
        });
    }

    let signed = await Pollinate.PayAfter.signCalls(wallet.signer, calls, fees);
    console.log(signed);

    const response = await fetch(`${POLLINATOR}/api/v1/payafter`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txn: signed }),
    });
    const result = await response.json();
    if (result.error) {
        fail(result.error.join('\n'));
    }
};

const checkInputs = () => {
    const to = $('#recipient-address input').val();
    let error = '';
    if (to !== '' && !ethers.isAddress(to)) {
        $('#recipient-address .error-message').text("Must be a valid ETN address");
        error = 'Address is invalid';
    } else {
        $('#recipient-address .error-message').text('');
        if (to === '') { error = 'Address is invalid'; }
    }
    const amtS = $('#amount input').val();
    let amt = BigInt(0);

    if (amtS !== '') {
        console.log(amtS);
        try {
            amt = ethers.parseEther(amtS);
            $('#amount .error-message').text('');
        } catch (e) {
            $('#amount .error-message').text("Must be a positive number");
            error = 'Amount is invalid';
        }
    } else {
        error = 'Amount is invalid';
    }

    if (!expectedFee) {
        error = 'Fee estimation not yet complete';
    }

    const fees = [];
    let timeSeconds = -1;
    $('#advanced-options .fee-entry').each((_, elem) => {
        elem = $(elem);
        if (timeSeconds >= 1e32) {
            elem.find('.error-message').text("Fees after an invalidation are not allowed");
            error = 'Invalid order of fee entries';
            return;
        }
        const ft = Number(elem.find('.fee-time input').val());
        const tu = elem.find('.fee-tu option:checked').val();
        if (isNaN(ft) || ft < 0 || ft > 127 || ft !== Math.floor(ft)) {
            elem.find('.fee-time .error-message').text("Fee time must be an integer between 0 and 127");
            error = `Invalid fee time [${elem.find('.fee-time input').val()}]`;
        } else {
            elem.find('.fee-time .error-message').text("");
        }
        if (['seconds','minutes','hours','days','weeks','months','years'].indexOf(tu) === -1) {
            error("Fee TU not selected, shouldn't happen");
            error = `Invalid time unit [${tu}]`;
            return;
        }

        if (elem.hasClass('fee-increase')) {
            const fm = Number(elem.find('.fee-mul input').val());

            let fee;
            if (isNaN(fm) || fm < 0) {
                elem.find('.fee-mul .error-message').text("Fee multiplier must be a positive number");
                error = `Invalid fee multipler ${elem.find('.fee-mul input').val()}`;
            } else {
                elem.find('.fee-mul .error-message').text("");
                if (error === '') {
                    fee = expectedFee * BigInt(Math.floor(fm * 1024*1024)) / BigInt(1024*1024);
                }
            }
         
            if (error === '') {
                const feeEntry = Pollinate.PayAfter.makeFee(fee).after(ft)[tu];
                if (feeEntry.timeSeconds() < timeSeconds) { 
                    elem.find('.error-message').text("Each fee entry must have a higher time entry than the last");
                    error = 'Invalid order of fee entries';
                }
                timeSeconds = feeEntry.timeSeconds();
                fees.push(feeEntry);
            }
        }
        if (elem.hasClass('fee-inval')) {
            if (error === '') {
                const feeEntry = Pollinate.PayAfter.makeInvalid().after(ft)[tu];
                if (feeEntry.timeSeconds() < timeSeconds) { 
                    elem.find('.error-message').text("Each fee entry must have a higher time entry than the last");
                    error = 'Invalid order of fee entries';
                }
                timeSeconds = 1e32;
                fees.push(feeEntry);
            }
        }
    });

    $('#send-transaction').attr('disabled', (error !== ''));
    $('#send-transaction').attr('title', error);

    return { error, to, amt, fees };
}

let periodicTick = 0;
const periodic = async () => {
    if (!wallet) { return; }
    checkInputs();
    periodicTick--;
    if ((periodicTick % 20) === 0) {
        const addr = await wallet.signer.getAddress();
        const res = await fetch(`${POLLINATOR}/api/v1/address-payafters/${addr}`);
        const resj = await res.json();
        if (resj.length === 0) {
            $('#my-transactions').hide();
        } else {
            const now = Math.floor(+new Date() / 1000);
            $('#my-transactions').show();
            $('#my-transactions tbody').empty();
            for (const txn of resj) {
                const status = $(`<td>`);
                if (txn.error) {
                    status.attr('title', txn.error);
                    status.text('Error...');
                } else if (txn.txid) {
                    status.text('Complete');
                } else if (txn.wait_until) {
                    if (now > txn.wait_until) {
                        status.text(`Submitting...`);
                    } else {
                        status.text(`Submit in ${txn.wait_until - now} sec`);
                    }
                } else {
                    status.text('??');
                }
                const created = $('<td>');
                created.text('' + (new Date(txn.create_time * 1000)));
                const dataHash = $('<td>');
                dataHash.text(txn.data_hash.slice(0,18));
                if (txn.data_hash) { dataHash.attr('title', txn.data_hash); }
                const txid = $('<td>');
                if (txn.txid) {
                    const txida = $('<a>');
                    txida.text(txn.txid.slice(0,18));
                    txida.attr('title', txn.txid);
                    txida.attr('href', 'https://blockexplorer.electroneum.com/tx/' + txn.txid);
                    txid.append(txida);
                } else {
                    txid.text('-');
                }

                const tr = $(`<tr>`);
                tr.append(status);
                tr.append(created);
                tr.append(dataHash);
                tr.append(txid);
                $('#my-transactions tbody').append(tr);
            }
        }
    }
    if (periodicTick > 0) { return; }
    periodicTick = 10 * 60;
    const addr = await wallet.signer.getAddress();
    $('#address').text(addr);
    const bal = await wallet.sneeze.balanceOf(addr);
    $('#sneeze-balance').text(ethers.formatEther(bal))
    const balance = await wallet.provider.getBalance(addr);
    $('#electroneum-balance').text(ethers.formatEther(balance));
    if (bal > BigInt(0)) {
        const { gas, feeData } = await createTransaction(
            '0xd62320bD3359A89A7150F4aFF108D4916E55e26c', BigInt(1));
        $('#projected-gas').text(gas);
        $('#expected-fee').text(ethers.formatEther(gas * feeData.maxFeePerGas));
        expectedFee = gas * feeData.maxFeePerGas;
    } else {
        $('#projected-gas').text('-');
        $('#expected-fee').text('-');
    }
};

$(function () {
    setInterval(periodic, 100);
    setFeePolicy('normal');
    $('#connect-wallet').click(() => {
        if ($('#wallet-connected').is(':hidden')) {
            (async () => {
                await connectWallet();
                if (wallet) {
                    $('#connect-wallet').text("Disconnect Wallet");
                    $('#wallet-connected').show();
                    periodicTick = 0;
                }
            })();
        } else {
            wallet = null;
            $('#connect-wallet').text("Connect Wallet");
            $('#wallet-connected').hide();
        }
    });

    $('#advanced-options-chk').click(() => {
        if ($('#advanced-options-chk').is(':checked')) {
            $('#advanced-options').show();
        } else {
            $('#advanced-options').hide();
        }
    });

    $('input[name="fee"]').on('click', () => {
        setFeePolicy($('input[name="fee"]:checked').val());
    });

    $('#send-transaction').click(() => {
        event.preventDefault();
        $('.spinner').show();
        const { error, to, amt, fees } = checkInputs();
        if (error !== '') {
            fail(error);
        } else {
            (async () => {
                await createTransaction(to, amt, fees);
                $('.spinner').hide();
            })();
        }
    });
});