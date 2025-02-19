import { ethers } from "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js";

$(function () {
    $('#connect-wallet').click(() => {
        if ($('#wallet-connected').is(':hidden')) {
            $('#sneeze-wallet-title').innerText = "Disconnect Wallet";
            $('#wallet-connected').show();
        } else {
            $('#sneeze-wallet-title').innerText = "Connect Wallet";
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

    $('#send-transaction').click(() => {
        event.preventDefault();
        $('.spinner').show();
        setTimeout(() => {
            $('.spinner').hide();
        }, 2000);
    });
})