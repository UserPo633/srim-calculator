const cheerio = require('cheerio');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function extractStockCode(input) {
  const text = String(input || '').trim();
  if (!text) {
    throw new Error('FnGuide URL 또는 종목코드를 입력해 주세요.');
  }

  const gicodeMatch = text.match(/gicode=A?(\d{6})/i);
  if (gicodeMatch) return gicodeMatch[1];

  const plainMatch = text.match(/A?(\d{6})/);
  if (plainMatch) return plainMatch[1];

  throw new Error('유효한 FnGuide URL 또는 6자리 종목코드를 입력해 주세요.');
}

function parseNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text || ['-', 'N/A', 'nan', '적전', '흑전', '완전잠식'].includes(text)) {
    return null;
  }
  const number = Number(text);
  return Number.isNaN(number) ? null : number;
}

function parseCompanyName($, stockCode) {
  const selectors = ['#giName', '.corp_group1 h1', '.corp_group2 h1', 'title'];
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) {
      if (selector === 'title') {
        return text.split('-')[0].trim() || stockCode;
      }
      return text;
    }
  }
  return stockCode;
}

function parseShares($) {
  let commonShares = null;
  let preferredShares = 0;

  $('tr').each((_, tr) => {
    if (commonShares !== null) return;
    const thText = $(tr).find('th').first().text().replace(/\s+/g, ' ').trim();
    if (!thText.includes('발행주식수')) return;

    const valueText = $(tr).find('td').first().text().replace(/\s+/g, ' ').trim();
    const numbers = valueText.match(/[\d,]+/g) || [];
    if (!numbers.length) return;

    commonShares = Number(numbers[0].replace(/,/g, ''));
    preferredShares = numbers[1] ? Number(numbers[1].replace(/,/g, '')) : 0;
  });

  if (commonShares === null) {
    throw new Error('FnGuide에서 발행주식수 정보를 찾지 못했습니다.');
  }

  return { commonShares, preferredShares };
}

function buildHeaders($, $table) {
  const topHeaders = [];
  $table.find('thead tr').first().find('th').each((index, th) => {
    if (index === 0) return;
    const label = $(th).find('div').first().text().trim() || $(th).text().trim();
    const colspan = Number($(th).attr('colspan') || 1);
    for (let i = 0; i < colspan; i += 1) {
      topHeaders.push(label);
    }
  });

  const bottomHeaders = [];
  $table.find('thead tr').eq(1).find('th').each((_, th) => {
    const text = $(th).text().replace(/\s+/g, ' ').trim();
    bottomHeaders.push(text);
  });

  return bottomHeaders.map((label, index) => ({
    section: topHeaders[index] || '',
    label,
  }));
}

function parseFinancialTable($, $table) {
  const headers = buildHeaders($, $table);
  const annualActualIndexes = headers
    .map((header, index) => ({ ...header, index }))
    .filter((header) => header.section === 'Annual' && /^\d{4}\/\d{2}$/.test(header.label));

  if (!annualActualIndexes.length) {
    throw new Error('FnGuide에서 연간 실제 데이터 컬럼을 찾지 못했습니다.');
  }

  const rowMap = new Map();
  $table.find('tbody tr').each((_, tr) => {
    const rowLabel = $(tr).find('th').first().text().replace(/\s+/g, ' ').trim();
    const cells = [];
    $(tr).find('td').each((__, td) => {
      cells.push($(td).text().replace(/\s+/g, ' ').trim());
    });
    if (rowLabel) rowMap.set(rowLabel, cells);
  });

  const latest = annualActualIndexes[annualActualIndexes.length - 1];
  const equityKey = [...rowMap.keys()].find((key) => key.startsWith('지배주주지분'));
  const roeKey = [...rowMap.keys()].find((key) => key.startsWith('ROE'));
  const equityRow = equityKey ? rowMap.get(equityKey) : null;
  const roeRow = roeKey ? rowMap.get(roeKey) : null;

  if (!equityRow || !roeRow) {
    throw new Error('FnGuide에서 지배주주지분 또는 ROE 행을 찾지 못했습니다.');
  }

  const equity = parseNumber(equityRow[latest.index]);
  const roe = parseNumber(roeRow[latest.index]);

  if (equity === null || roe === null) {
    throw new Error('FnGuide에서 지배주주지분 또는 ROE 값을 읽지 못했습니다.');
  }

  return {
    basisPeriod: latest.label,
    equityEok: Math.round(equity),
    roePct: Number(roe),
  };
}

function parseFnGuide(html, stockCode) {
  const $ = cheerio.load(html);
  const companyName = parseCompanyName($, stockCode);
  const { commonShares, preferredShares } = parseShares($);

  let parsedFinancial = null;

  $('table').each((_, table) => {
    if (parsedFinancial) return;
    const $table = $(table);
    const allText = $table.text().replace(/\s+/g, ' ').trim();
    const firstHeader = $table.find('thead tr').first().find('th').first().text().replace(/\s+/g, ' ').trim();

    if (!allText.includes('지배주주지분') || !allText.includes('ROE')) return;
    if (!firstHeader.includes('IFRS(연결)')) return;

    try {
      parsedFinancial = parseFinancialTable($, $table);
    } catch (error) {
      // continue searching next candidate table
    }
  });

  if (!parsedFinancial) {
    throw new Error('FnGuide에서 연결 기준 재무표를 찾지 못했습니다.');
  }

  return {
    companyName,
    stockCode,
    sourceUrl: `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${stockCode}`,
    basisPeriod: parsedFinancial.basisPeriod,
    equityEok: parsedFinancial.equityEok,
    roePct: parsedFinancial.roePct,
    requiredRate: 8,
    commonShares,
    preferredShares,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'POST 요청만 허용됩니다.' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const stockCode = extractStockCode(payload.sourceInput);
    const sourceUrl = `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${stockCode}`;

    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      throw new Error(`FnGuide 요청 실패 (${response.status})`);
    }

    const html = await response.text();
    const data = parseFnGuide(html, stockCode);
    return json(200, { ok: true, data });
  } catch (error) {
    return json(400, { ok: false, error: error.message || 'FnGuide 자동 채우기에 실패했습니다.' });
  }
};
