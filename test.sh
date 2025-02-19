#!/bin/sh

set -e
set -x

lns() {
    rm "$2" || true
    ln -s "$1" "$2"
}

npm run build

if [ ! -e './node_modules/@uniswap/patch_applied' ]; then
    find './node_modules/@uniswap/v3-periphery/contracts' -name '*.sol' | while read x; do
        sed -i -e 's#^\(import ["'\'']\)@openzeppelin/contracts#\1@uniswap/v3-periphery/node_modules/@openzeppelin/contracts#g' "$x"
    done
    find './node_modules/@uniswap/swap-router-contracts/contracts' -name '*.sol' | while read x; do
        sed -i -e 's#^\(import ["'\'']\)@openzeppelin/contracts#\1@uniswap/v3-periphery/node_modules/@openzeppelin/contracts#g' "$x"
    done

    patch -p1 < ./patches/UniswapFactory-no-unsafe-cast.patch
    touch './node_modules/@uniswap/patch_applied'
fi

npx hardhat test