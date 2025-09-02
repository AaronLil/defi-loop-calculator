// --- State, Config & Language ---
let currentLanguage = 'pt';
let selectedAsset = 'bitcoin';
let allLoopsData = [];
let baseAssetPrice = 0;
let currentPrice = 0;
let currentLoopIndex = 0;
let recommendedLoopIndex = 0;
let calculationDone = false;
// removed volatility priceStep

const assetParams = {
    bitcoin: { id: 'bitcoin', symbol: 'BTC', ltv: 70, threshold: 75 },
    ethereum: { id: 'ethereum', symbol: 'ETH', ltv: 82.5, threshold: 85 }
};

const donationAddresses = {
    btc: "bc1psnea5ypndy5j5v7hwe0way0vzjevvwygw4uj97q3p4r8wawsnrvqxdx6kl",
    eth: "0x67665A0888bF0FED7a04f122c5620A4149e1902E"
};

// --- DOM Elements (Cached for performance) ---
const dom = {
    assetPriceInput: document.getElementById('assetPrice'),
    // volatility removed: priceSlider
    ltvInput: document.getElementById('ltv'),
    liquidationThresholdInput: document.getElementById('liquidationThreshold'),
    // volatility removed: priceChangePercent, volatilityControls, currentPriceDisplay
    currentLoopDisplay: document.getElementById('currentLoopDisplay'),
    results: document.getElementById('results'),
    warning: document.getElementById('warning'),
    healthFactorDisplay: document.getElementById('healthFactorDisplay'),
    liquidationPrice: document.getElementById('liquidationPrice'),
    finalCollateral: document.getElementById('finalCollateral'),
    finalCollateralUsd: document.getElementById('finalCollateralUsd'),
    finalDebt: document.getElementById('finalDebt'),
    loopCounter: document.getElementById('loopCounter'),
    loopsTableBody: document.getElementById('loopsTableBody'),
    priceMinusBtn: document.getElementById('priceMinusBtn'),
    pricePlusBtn: document.getElementById('pricePlusBtn'),
    // loopSlider removed
    loopMinusBtn: document.getElementById('loopMinusBtn'),
    loopPlusBtn: document.getElementById('loopPlusBtn'),
    currentDebtInput: document.getElementById('currentDebt')
};

function debounce(fn, wait) {
    let t = null;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

function renderLanguage(lang) {
    if (!window.translations || !translations[lang]) return;
    currentLanguage = lang;
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
    document.querySelectorAll('[data-lang-key]').forEach(el => {
        const key = el.dataset.langKey;
        let text = translations[lang][key] || '';
        if (key === 'chartTitle') {
            text = text.replace('{asset}', assetParams[selectedAsset].symbol);
        }
        if (text) el.textContent = text;
    });
    document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
    if (allLoopsData.length > 0) {
        runFullSimulation(currentPrice, false);
    }
}

async function fetchAssetData(assetId) {
    try {
        const priceResponse = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd`);
        if (!priceResponse.ok) throw new Error(translations[currentLanguage].apiErrorPrice);
        const priceData = await priceResponse.json();
        const livePrice = priceData[assetId].usd;

        baseAssetPrice = livePrice;
        dom.assetPriceInput.value = livePrice.toFixed(2);
        currentPrice = livePrice;
    } catch (error) {
        console.error("CoinGecko API Error:", error);
        const fallbackPrice = assetId === 'bitcoin' ? 65000 : 3500;
        baseAssetPrice = fallbackPrice;
        dom.assetPriceInput.value = fallbackPrice;
        currentPrice = fallbackPrice;
        dom.assetPriceInput.readOnly = false;
    }
}

function getHealthFactorColor(hf) {
    if (!isFinite(hf)) return 'text-green-400';
    if (hf <= 1.07) return 'text-red-500';
    if (hf <= 1.25) return 'text-orange-400';
    if (hf <= 1.5) return 'text-yellow-400';
    return 'text-green-400';
}

function updateDisplayForLoop(loopIndex) {
    const data = allLoopsData[loopIndex];
    if (!data) return;

    const simulatedPrice = currentPrice;
    const locale = currentLanguage === 'pt' ? 'pt-BR' : 'en-US';
    const assetSymbol = assetParams[selectedAsset].symbol;

    const finalCollateralValueUsd = data.totalCollateral * simulatedPrice;
    const liquidationThresholdValue = parseFloat(dom.liquidationThresholdInput.value) / 100;
    const currentHealthFactor = data.totalBorrowedUsd > 0
        ? (finalCollateralValueUsd * liquidationThresholdValue) / data.totalBorrowedUsd
        : Infinity;

    const liquidationPrice = data.totalCollateral > 0 ? data.totalBorrowedUsd / (data.totalCollateral * liquidationThresholdValue) : 0;

    dom.healthFactorDisplay.textContent = isFinite(currentHealthFactor) ? currentHealthFactor.toFixed(2) : '∞';
    dom.healthFactorDisplay.className = `text-2xl font-bold ${getHealthFactorColor(currentHealthFactor)}`;

    dom.liquidationPrice.textContent = `$${liquidationPrice.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    dom.finalCollateral.textContent = `$${finalCollateralValueUsd.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    dom.finalCollateralUsd.textContent = `${data.totalCollateral.toFixed(4)} ${assetSymbol}`;
    dom.finalDebt.textContent = `$${data.totalBorrowedUsd.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    dom.loopCounter.textContent = `Loop ${data.loopCount} / ${allLoopsData.length - 1}`;
}

function updateLoopControls() {
    dom.currentLoopDisplay.textContent = currentLoopIndex;
    const maxIndex = Math.max(0, allLoopsData.length - 1);
    dom.loopCounter.textContent = `Loop ${currentLoopIndex} / ${maxIndex}`;

    dom.loopMinusBtn.disabled = currentLoopIndex <= 0 || allLoopsData.length === 0;
    dom.loopPlusBtn.disabled = currentLoopIndex >= maxIndex || allLoopsData.length === 0;
}

function populateLoopsTable(loops) {
    dom.loopsTableBody.innerHTML = '';
    const locale = currentLanguage === 'pt' ? 'pt-BR' : 'en-US';
    const assetSymbol = assetParams[selectedAsset].symbol;
    const liquidationThreshold = parseFloat(dom.liquidationThresholdInput.value) / 100;

    loops.forEach(loop => {
        const collateralUsd = loop.totalCollateral * currentPrice;
        const hf = loop.totalBorrowedUsd > 0 ? (collateralUsd * liquidationThreshold) / loop.totalBorrowedUsd : Infinity;
        const hfClass = getHealthFactorColor(hf);
        const row = `
            <tr class="bg-gray-800 border-b border-gray-700 hover:bg-gray-700/50">
                <td class="px-6 py-4 font-medium">${loop.loopCount}</td>
                <td class="px-6 py-4">${loop.totalCollateral.toFixed(6)} ${assetSymbol}</td>
                <td class="px-6 py-4">$${collateralUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="px-6 py-4">$${loop.totalBorrowedUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="px-6 py-4 font-bold ${hfClass}">${isFinite(hf) ? hf.toFixed(4) : '∞'}</td>
                <td class="px-6 py-4">${(loop.leverage * (currentPrice / (baseAssetPrice || currentPrice))).toFixed(2)}x</td>
            </tr>`;
        dom.loopsTableBody.insertAdjacentHTML('beforeend', row);
    });
}

function calculateRecommendedLoop() {
    if (allLoopsData.length <= 1) {
        recommendedLoopIndex = 0;
    } else {
        let idealLoopIndex = 1;
        let smallestDiff = Infinity;
        const liquidationThreshold = parseFloat(dom.liquidationThresholdInput.value) / 100;
        for (let i = 1; i < allLoopsData.length; i++) {
            const finalCollateralUsd = allLoopsData[i].totalCollateral * currentPrice;
            const hf = allLoopsData[i].totalBorrowedUsd > 0 ? (finalCollateralUsd * liquidationThreshold) / allLoopsData[i].totalBorrowedUsd : Infinity;
            const diff = Math.abs(hf - 1.40);
            if (diff < smallestDiff) {
                smallestDiff = diff;
                idealLoopIndex = i;
            }
        }
        recommendedLoopIndex = idealLoopIndex;
    }

    // Atualiza cards informativos
    const conservativeEl = document.getElementById('conservativeInfo');
    const recommendedEl = document.getElementById('recommendedInfo');
    const degenEl = document.getElementById('degenInfo');

    if (conservativeEl) {
        conservativeEl.textContent = allLoopsData.length > 1 ? '1' : '0';
    }
    if (recommendedEl) {
        recommendedEl.textContent = allLoopsData.length > 0 ? allLoopsData[recommendedLoopIndex].loopCount : '0';
    }
    if (degenEl) {
        degenEl.textContent = allLoopsData.length > 0 ? allLoopsData[allLoopsData.length - 1].loopCount : '0';
    }
}

function handleAssetChange(newAsset) {
    selectedAsset = newAsset;
    document.querySelectorAll('.asset-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.asset === newAsset));

    const params = assetParams[newAsset];
    dom.ltvInput.value = params.ltv;
    dom.liquidationThresholdInput.value = params.threshold;

    fetchAssetData(newAsset);
    dom.results.classList.add('hidden');
    renderLanguage(currentLanguage);
}

function runFullSimulation(assetPrice, rebuild = true) {
    const initialAmount = parseFloat(document.getElementById('initialAmount').value);
    const ltv = parseFloat(dom.ltvInput.value) / 100;
    const liquidationThreshold = parseFloat(dom.liquidationThresholdInput.value) / 100;
    const currentDebt = parseFloat(dom.currentDebtInput.value) || 0;

    if (isNaN(initialAmount) || isNaN(assetPrice) || isNaN(ltv) || isNaN(liquidationThreshold) || initialAmount <= 0) return;

    currentPrice = assetPrice;
    allLoopsData = [];
    let totalCollateral = initialAmount;
    let totalBorrowedUsd = currentDebt;
    const initialCollateralUsd = initialAmount * assetPrice;

    allLoopsData.push({ loopCount: 0, totalCollateral, totalBorrowedUsd, healthFactor: Infinity, leverage: 1 });

    let loopCount = 0;
    const MAX_LOOPS = 100;
    while (loopCount < MAX_LOOPS) {
        loopCount++;
        const totalCollateralUsd = totalCollateral * assetPrice;
        const newBorrowableUsd = (totalCollateralUsd * ltv) - totalBorrowedUsd;

        const nextTotalBorrowedUsd = totalBorrowedUsd + newBorrowableUsd;
        const nextTotalCollateral = totalCollateral + (newBorrowableUsd / assetPrice);
        const nextTotalCollateralUsd = nextTotalCollateral * assetPrice;
        const nextHealthFactor = nextTotalBorrowedUsd > 0 ? (nextTotalCollateralUsd * liquidationThreshold) / nextTotalBorrowedUsd : Infinity;

        if (newBorrowableUsd < 1.0 || nextHealthFactor <= 1.07) {
            break;
        }

        totalBorrowedUsd = nextTotalBorrowedUsd;
        totalCollateral = nextTotalCollateral;
        const leverage = initialCollateralUsd > 0 ? (totalCollateral * assetPrice) / initialCollateralUsd : 0;

        allLoopsData.push({ loopCount, totalCollateral, totalBorrowedUsd, healthFactor: nextHealthFactor, leverage });
    }

    calculateRecommendedLoop();

    if (currentLoopIndex > allLoopsData.length - 1) currentLoopIndex = allLoopsData.length - 1;
    if (currentLoopIndex < 0) currentLoopIndex = 0;

    populateLoopsTable(allLoopsData);
    updateDisplayForLoop(currentLoopIndex);
    updateLoopControls();

    if (rebuild) {
        dom.results.classList.remove('hidden');
        dom.warning.classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderLanguage(currentLanguage);
    handleAssetChange(selectedAsset);

    document.getElementById('lang-switcher').addEventListener('click', (e) => {
        if (e.target.dataset.lang) renderLanguage(e.target.dataset.lang);
    });

    document.querySelectorAll('.asset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleAssetChange(e.target.dataset.asset));
    });

    dom.loopMinusBtn.addEventListener('click', () => {
        if (calculationDone && currentLoopIndex > 0) {
            currentLoopIndex--;
            updateDisplayForLoop(currentLoopIndex);
            updateLoopControls();
        }
    });

    dom.loopPlusBtn.addEventListener('click', () => {
        if (calculationDone && currentLoopIndex < allLoopsData.length - 1) {
            currentLoopIndex++;
            updateDisplayForLoop(currentLoopIndex);
            updateLoopControls();
        }
    });

    const preset = {
        conservative: () => {
            if (allLoopsData.length > 1) {
                currentLoopIndex = Math.min(1, allLoopsData.length - 1);
            } else currentLoopIndex = 0;
            calculationDone = true;
            updateDisplayForLoop(currentLoopIndex);
            updateLoopControls();
        },
        recommended: () => {
            currentLoopIndex = Math.max(0, Math.min(allLoopsData.length - 1, recommendedLoopIndex));
            calculationDone = true;
            updateDisplayForLoop(currentLoopIndex);
            updateLoopControls();
        },
        degen: () => {
            currentLoopIndex = Math.max(0, allLoopsData.length - 1);
            calculationDone = true;
            updateDisplayForLoop(currentLoopIndex);
            updateLoopControls();
        }
    };

    // Re-bind new preset buttons
    const pc = document.getElementById('presetConservative');
    const pr = document.getElementById('presetRecommended');
    const pd = document.getElementById('presetDegen');
    if (pc) pc.addEventListener('click', () => { preset.conservative(); runFullSimulation(currentPrice, false); updateLoopControls(); });
    if (pr) pr.addEventListener('click', () => { preset.recommended(); runFullSimulation(currentPrice, false); updateLoopControls(); });
    if (pd) pd.addEventListener('click', () => { preset.degen(); runFullSimulation(currentPrice, false); updateLoopControls(); });

    dom.assetPriceInput.addEventListener('change', (e) => {
        const newPrice = parseFloat(e.target.value);
        if (!isNaN(newPrice) && newPrice > 0) {
            calculationDone = true;
            runFullSimulation(newPrice, false);
        }
    });

    dom.assetPriceInput.addEventListener('input', debounce((e) => {
        const newPrice = parseFloat(e.target.value);
        if (!isNaN(newPrice) && newPrice > 0) {
            calculationDone = true;
            runFullSimulation(newPrice, false);
        }
    }, 300));

    document.getElementById('calculateBtn').addEventListener('click', () => {
        const assetPrice = baseAssetPrice;
        currentLoopIndex = 0;
        dom.currentLoopDisplay.textContent = 0;
        dom.assetPriceInput.value = assetPrice.toFixed(2);
        calculationDone = true;
        runFullSimulation(assetPrice);
        updateLoopControls();
    });

    const donateModal = document.getElementById('donate-modal');
    const btcTab = document.getElementById('btc-tab');
    const ethTab = document.getElementById('eth-tab');
    const btcContent = document.getElementById('btc-content');
    const ethContent = document.getElementById('eth-content');

    function switchTab(activeTab, activeContent, inactiveTab, inactiveContent) {
        activeTab.classList.add('bg-blue-600', 'text-white');
        activeTab.classList.remove('text-gray-300');
        inactiveTab.classList.remove('bg-blue-600', 'text-white');
        inactiveTab.classList.add('text-gray-300');
        activeContent.classList.remove('hidden');
        inactiveContent.classList.add('hidden');
    }
    btcTab.addEventListener('click', () => switchTab(btcTab, btcContent, ethTab, ethContent));
    ethTab.addEventListener('click', () => switchTab(ethTab, ethContent, btcTab, btcContent));

    document.getElementById('donate-btn').addEventListener('click', () => {
        document.getElementById('address-btc').value = donationAddresses.btc;
        document.getElementById('qr-code-btc').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${donationAddresses.btc}`;
        document.getElementById('address-eth').value = donationAddresses.eth;
        document.getElementById('qr-code-eth').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${donationAddresses.eth}`;
        switchTab(btcTab, btcContent, ethTab, ethContent);
        donateModal.classList.remove('hidden');
    });

    document.getElementById('close-modal-btn').addEventListener('click', () => donateModal.classList.add('hidden'));
    donateModal.addEventListener('click', (e) => { if (e.target === donateModal) donateModal.classList.add('hidden'); });

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetInput = document.getElementById(e.target.dataset.copyTarget);
            targetInput.select();
            document.execCommand('copy');
            const originalText = e.target.textContent;
            e.target.textContent = translations[currentLanguage].copied;
            setTimeout(() => { e.target.textContent = originalText; }, 1500);
        });
    });
});