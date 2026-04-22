const DEFAULTS = {
  sourceInput: '',
  stockCode: '',
  companyName: '',
  equityEok: 1230888,
  roePct: 12,
  requiredRate: 8,
  commonShares: 204757766,
  preferredShares: 60632342,
};

const SCENARIOS = [
  { omega: 0.8, title: '매수 타이밍', desc: '지속계수 0.8 — 안전마진 확보 구간' },
  { omega: 0.9, title: '1차 매도 타이밍', desc: '지속계수 0.9 — 적정 가치 도달' },
  { omega: 1.0, title: '완전 매도 타이밍', desc: '지속계수 1.0 — 초과이익 영구 지속 가정' },
];

const el = {
  form: document.getElementById('simulatorForm'),
  sourceInput: document.getElementById('sourceInput'),
  fillButton: document.getElementById('fillButton'),
  fillStatus: document.getElementById('fillStatus'),
  sourceMeta: document.getElementById('sourceMeta'),
  stockCode: document.getElementById('stockCode'),
  companyName: document.getElementById('companyName'),
  equityEok: document.getElementById('equityEok'),
  roePct: document.getElementById('roePct'),
  requiredRate: document.getElementById('requiredRate'),
  commonShares: document.getElementById('commonShares'),
  preferredShares: document.getElementById('preferredShares'),
  totalSharesBadge: document.getElementById('totalSharesBadge'),
  summaryCompany: document.getElementById('summaryCompany'),
  summaryEquity: document.getElementById('summaryEquity'),
  summaryRates: document.getElementById('summaryRates'),
  scenarioList: document.getElementById('scenarioList'),
  errorBox: document.getElementById('errorBox'),
  resetButton: document.getElementById('resetButton'),
};

function stripComma(value) {
  return String(value ?? '').replace(/,/g, '').trim();
}

function toNumber(value, label) {
  const cleaned = stripComma(value);
  if (!cleaned) throw new Error(`${label} 값을 입력해 주세요.`);
  const number = Number(cleaned);
  if (Number.isNaN(number)) throw new Error(`${label}은(는) 숫자여야 합니다.`);
  return number;
}

function formatNumber(value) {
  return Math.round(Number(value)).toLocaleString('ko-KR');
}

function formatInput(input) {
  const raw = stripComma(input.value);
  if (!raw || raw === '-' || raw === '.') return;
  const num = Number(raw);
  if (Number.isNaN(num)) return;
  input.value = num.toLocaleString('ko-KR');
}

function calculateValue(equityEok, roePct, requiredRatePct, omega) {
  const roe = roePct / 100;
  const ke = requiredRatePct / 100;
  if (ke <= 0) throw new Error('요구수익률은 0보다 커야 합니다.');
  if (omega === 1) return equityEok + equityEok * (roe - ke) / ke;
  const denominator = 1 + ke - omega;
  if (denominator <= 0) throw new Error('지속계수와 요구수익률 조합이 유효하지 않습니다.');
  return equityEok + equityEok * (roe - ke) * omega / denominator;
}

function getFormValues() {
  const equityEok = toNumber(el.equityEok.value, '지배기업 소유주 지분');
  const roePct = toNumber(el.roePct.value, '예상 ROE');
  const requiredRate = toNumber(el.requiredRate.value, '요구수익률');
  const commonShares = toNumber(el.commonShares.value, '보통주 발행주식수');
  const preferredShares = toNumber(el.preferredShares.value, '우선주 발행주식수');
  const stockCode = stripComma(el.stockCode.value);
  const companyName = el.companyName.value.trim();

  if (equityEok <= 0) throw new Error('지배기업 소유주 지분은 0보다 커야 합니다.');
  if (commonShares < 0 || preferredShares < 0) throw new Error('발행주식수는 0 이상이어야 합니다.');
  if (commonShares + preferredShares <= 0) throw new Error('총 발행주식수는 0보다 커야 합니다.');

  return { equityEok, roePct, requiredRate, commonShares, preferredShares, stockCode, companyName };
}

function renderResults(values) {
  const totalShares = values.commonShares + values.preferredShares;
  el.totalSharesBadge.textContent = `총 주식수 ${formatNumber(totalShares)}주`;
  el.summaryCompany.textContent = values.companyName
    ? `${values.companyName}${values.stockCode ? ` (${values.stockCode})` : ''}`
    : values.stockCode || '-';
  el.summaryEquity.textContent = `${formatNumber(values.equityEok)}억`;
  el.summaryRates.textContent = `${values.roePct}% / ${values.requiredRate}%`;

  el.scenarioList.innerHTML = '';
  SCENARIOS.forEach((scenario, index) => {
    const valueEok = calculateValue(values.equityEok, values.roePct, values.requiredRate, scenario.omega);
    const price = (valueEok * 100000000) / totalShares;
    const article = document.createElement('article');
    article.className = `scenario scenario-${index + 1}`;
    article.innerHTML = `
      <div class="scenario-top">
        <div>
          <div class="scenario-title">${scenario.title}</div>
          <div class="scenario-sub">ω = ${scenario.omega.toFixed(1)}</div>
        </div>
        <span class="omega-pill">지속계수 ${scenario.omega.toFixed(1)}</span>
      </div>
      <p class="scenario-desc">${scenario.desc}</p>
      <div class="metric-block">
        <div class="metric-label">주당 가치</div>
        <div class="metric-value">${formatNumber(price)} 원</div>
      </div>
      <div class="metric-block soft">
        <div class="metric-label">적정 시가총액</div>
        <div class="metric-value">${formatNumber(valueEok)} 억 원</div>
      </div>
    `;
    el.scenarioList.appendChild(article);
  });
}

function showError(message) {
  el.errorBox.hidden = false;
  el.errorBox.textContent = message;
}

function clearError() {
  el.errorBox.hidden = true;
  el.errorBox.textContent = '';
}

function runCalculation() {
  clearError();
  try {
    const values = getFormValues();
    renderResults(values);
    localStorage.setItem('srim-netlify-functions-form', JSON.stringify({
      sourceInput: el.sourceInput.value.trim(),
      stockCode: values.stockCode,
      companyName: values.companyName,
      equityEok: values.equityEok,
      roePct: values.roePct,
      requiredRate: values.requiredRate,
      commonShares: values.commonShares,
      preferredShares: values.preferredShares,
      sourceMeta: el.sourceMeta.innerHTML,
      fillStatus: el.fillStatus.textContent,
    }));
  } catch (error) {
    showError(error.message);
  }
}

function applyValues(values) {
  el.sourceInput.value = values.sourceInput || '';
  el.stockCode.value = values.stockCode || '';
  el.companyName.value = values.companyName || '';
  el.equityEok.value = formatNumber(values.equityEok);
  el.roePct.value = String(values.roePct);
  el.requiredRate.value = String(values.requiredRate);
  el.commonShares.value = formatNumber(values.commonShares);
  el.preferredShares.value = formatNumber(values.preferredShares);
}

function restoreSavedValues() {
  const saved = localStorage.getItem('srim-netlify-functions-form');
  if (!saved) {
    applyValues(DEFAULTS);
    return;
  }
  try {
    const parsed = JSON.parse(saved);
    applyValues({ ...DEFAULTS, ...parsed });
    if (parsed.sourceMeta) el.sourceMeta.innerHTML = parsed.sourceMeta;
    if (parsed.fillStatus) el.fillStatus.textContent = parsed.fillStatus;
  } catch (_) {
    applyValues(DEFAULTS);
  }
}

async function fillFromFnGuide() {
  const sourceInput = el.sourceInput.value.trim();
  if (!sourceInput) {
    el.fillStatus.textContent = 'FnGuide URL 또는 종목코드를 입력해 주세요.';
    return;
  }

  clearError();
  el.fillStatus.textContent = 'FnGuide 데이터 불러오는 중...';
  el.sourceMeta.innerHTML = '';
  el.fillButton.disabled = true;

  try {
    const response = await fetch('/.netlify/functions/fnguide-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceInput }),
    });
    const json = await response.json();
    if (!response.ok || !json.ok) {
      throw new Error(json.error || '자동 채우기에 실패했습니다.');
    }

    const data = json.data;
    el.stockCode.value = data.stockCode;
    el.companyName.value = data.companyName;
    el.equityEok.value = formatNumber(data.equityEok);
    el.roePct.value = String(data.roePct);
    if (!stripComma(el.requiredRate.value)) {
      el.requiredRate.value = String(data.requiredRate);
    }
    el.commonShares.value = formatNumber(data.commonShares);
    el.preferredShares.value = formatNumber(data.preferredShares);
    el.fillStatus.textContent = `${data.companyName} (${data.stockCode}) 기준 값을 불러왔습니다.`;
    el.sourceMeta.innerHTML = `기준 연도: <strong>${data.basisPeriod}</strong> · 출처: <a href="${data.sourceUrl}" target="_blank" rel="noopener noreferrer">FnGuide 바로가기</a>`;
    runCalculation();
  } catch (error) {
    el.fillStatus.textContent = error.message;
    showError(error.message);
  } finally {
    el.fillButton.disabled = false;
  }
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  runCalculation();
});

el.fillButton.addEventListener('click', fillFromFnGuide);

el.resetButton.addEventListener('click', () => {
  localStorage.removeItem('srim-netlify-functions-form');
  el.sourceMeta.innerHTML = '';
  el.fillStatus.textContent = 'FnGuide 입력 대기 중';
  clearError();
  applyValues(DEFAULTS);
  runCalculation();
});

[el.equityEok, el.commonShares, el.preferredShares].forEach((input) => {
  input.addEventListener('blur', () => formatInput(input));
});

restoreSavedValues();
runCalculation();
