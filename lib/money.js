// lib/money.js — สูตรเงินแท้ของระบบ (ย้ายจาก index.js ใน v1.0.19 แบบ "เนื้อในเหมือนเดิมทุกตัวอักษร")
// หลักการ: ทุกฟังก์ชันรับ "การตั้งค่าร้าน" เป็นอาร์กิวเมนต์แรก (cfg = { priceList, shippingFee, freeShippingThreshold, addLog })
// จึงเป็น pure ต่อข้อมูลร้าน ทดสอบได้ตรง ๆ โดยไม่ต้องตัดโค้ดจาก index.js
// index.js ครอบด้วย wrapper บางๆ ที่ผูกค่าตั้งค่าปัจจุบันของร้านให้ทุกครั้ง — จุดเรียกใช้ทั้งระบบจึงเหมือนเดิมทุกประการ
'use strict';

const MAX_DP_BUDGET = 500000; // เพดานคำนวณอัตโนมัติ 500,000 บาท (คำนวณในหน่วยความจำ <3MB, เวลา <10ms ป้องกัน Event Loop ค้าง)

// opts.holdExactPrice: ถ้าลูกค้ายังไม่เคยได้ของในรอบนี้ และยอดรวมเท่ากับราคาสินค้าชิ้นใดชิ้นหนึ่งพอดี
// แปลว่าลูกค้าน่าจะลืมโอนค่าส่ง -> ให้รอค่าส่งก่อน แทนที่จะให้สินค้าชิ้นอื่นที่ราคาถูกกว่า (เช่น โอน 189 ลืมค่าส่ง แต่ระบบให้ 149+ค่าส่ง)
function calculateBestDraws(cfg, virtualBalance, pastDraws, opts = {}) {
    const best = calculateBestDrawsCore(cfg, virtualBalance, pastDraws);
    if (opts.holdExactPrice && best.draws > 0 && best.appliedShipping && !(pastDraws > 0) && Array.isArray(cfg.priceList)) {
        const exact = cfg.priceList.some(p => Math.abs(p.price - virtualBalance) < 0.005);
        if (exact) {
            if (cfg.addLog) cfg.addLog('INFO', `ยอด ${virtualBalance}฿ เท่าราคาสินค้าพอดี ยังไม่ได้ค่าส่ง ${cfg.shippingFee}฿ -- พักยอดรอค่าส่ง`);
            return { draws: 0, remainder: virtualBalance, cost: 0, isFreeShip: false, appliedShipping: false, breakdown: [], heldForShipping: true };
        }
    }
    return best;
}

function calculateBestDrawsCore(cfg, virtualBalance, pastDraws) {
    const { priceList, shippingFee, freeShippingThreshold, addLog } = cfg;
    let best = { draws: 0, remainder: virtualBalance, cost: 0, isFreeShip: false, appliedShipping: false, breakdown: [] };
    if (!priceList || priceList.length === 0) return best;

    const items = [...priceList].sort((a, b) => b.price - a.price);
    const minPrice = Math.min(...items.map(p => p.price));
    if (!(minPrice > 0) || !(virtualBalance >= minPrice)) return best;

    const B = Math.floor(virtualBalance);
    if (B > MAX_DP_BUDGET) {
        if (addLog) addLog('WARN', `ยอด ${virtualBalance}฿ เกินเพดานคำนวณอัตโนมัติ (${MAX_DP_BUDGET}฿) — กรุณาตรวจสอบและกรอกยอดด้วยตนเอง`);
        return best;
    }

    // Dynamic Programming 2-State: State 0 = ค่าส่งปกติ, State 1 = ส่งฟรี (เมื่อสะสมครบ threshold)
    const maxDraws0 = new Int32Array(B + 1).fill(-1);
    const lastItem0 = new Int16Array(B + 1).fill(-1);
    const maxDraws1 = new Int32Array(B + 1).fill(-1);
    const lastItem1 = new Int16Array(B + 1).fill(-1);
    const fromState1 = new Uint8Array(B + 1);

    if (pastDraws < freeShippingThreshold) {
        maxDraws0[0] = 0;
    } else {
        maxDraws1[0] = 0;
    }

    for (let c = 0; c <= B; c++) {
        const d0 = maxDraws0[c];
        if (d0 >= 0) {
            for (let i = 0; i < items.length; i++) {
                const nextC = c + items[i].price;
                if (nextC > B) continue;
                const nextD = d0 + 1;
                const isFree = (pastDraws + nextD) >= freeShippingThreshold;
                if (!isFree) {
                    if (nextD > maxDraws0[nextC]) {
                        maxDraws0[nextC] = nextD;
                        lastItem0[nextC] = i;
                    }
                } else {
                    if (nextD > maxDraws1[nextC]) {
                        maxDraws1[nextC] = nextD;
                        lastItem1[nextC] = i;
                        fromState1[nextC] = 0;
                    }
                }
            }
        }
        const d1 = maxDraws1[c];
        if (d1 >= 0) {
            for (let i = 0; i < items.length; i++) {
                const nextC = c + items[i].price;
                if (nextC > B) continue;
                const nextD = d1 + 1;
                if (nextD > maxDraws1[nextC]) {
                    maxDraws1[nextC] = nextD;
                    lastItem1[nextC] = i;
                    fromState1[nextC] = 1;
                }
            }
        }
    }

    let bestC = -1;
    let bestState = -1;

    for (let c = 1; c <= B; c++) {
        const d0 = maxDraws0[c];
        if (d0 > 0) {
            const total = c + shippingFee;
            if (total <= virtualBalance) {
                const rem = virtualBalance - total;
                if (rem < best.remainder || (rem === best.remainder && d0 > best.draws)) {
                    best = { draws: d0, remainder: rem, cost: total, isFreeShip: false, appliedShipping: true, breakdown: [] };
                    bestC = c;
                    bestState = 0;
                }
            }
        }
        const d1 = maxDraws1[c];
        if (d1 > 0) {
            const total = c;
            if (total <= virtualBalance) {
                const rem = virtualBalance - total;
                if (rem < best.remainder || (rem === best.remainder && d1 > best.draws)) {
                    best = { draws: d1, remainder: rem, cost: total, isFreeShip: true, appliedShipping: false, breakdown: [] };
                    bestC = c;
                    bestState = 1;
                }
            }
        }
    }

    if (bestC > 0) {
        const counts = new Array(items.length).fill(0);
        let currC = bestC;
        let currState = bestState;
        while (currC > 0) {
            const itemIdx = currState === 1 ? lastItem1[currC] : lastItem0[currC];
            if (itemIdx < 0) break;
            counts[itemIdx]++;
            const itemPrice = items[itemIdx].price;
            if (currState === 1) {
                currState = fromState1[currC];
            }
            currC -= itemPrice;
        }
        best.breakdown = counts.map((q, i) => (q > 0 ? `${items[i].name} x${q}` : null)).filter(Boolean);
    }
    return best;
}

function describeTopup(cfg, balance, pastDraws) {
    const { priceList, shippingFee, freeShippingThreshold } = cfg;
    // บอกว่าลูกค้าที่ยอดยังไม่พอ ต้องโอนเพิ่มอีกเท่าไหร่ (ใช้แจ้งแม่ค้าและลูกค้า ไม่ใช้ตัดสินสิทธิ์)
    if (!priceList || priceList.length === 0) return null;
    const prices = priceList.map(p => Number(p.price)).filter(p => p > 0);
    if (prices.length === 0) return null;
    const minPrice = Math.min(...prices);
    const hasPaidShipping = (pastDraws > 0 && pastDraws < freeShippingThreshold);
    const virtual = balance + (hasPaidShipping ? shippingFee : 0);
    const feeCharged = (pastDraws + 1) < freeShippingThreshold;
    const held = pastDraws === 0 && feeCharged && prices.some(p => Math.abs(p - virtual) < 0.005);
    const need = held ? shippingFee : Math.max(0, minPrice + (feeCharged ? shippingFee : 0) - virtual);
    return { need: Math.round(need * 100) / 100, held, virtual };
}

// 💰 ยอดที่ต้องเก็บเข้ากระเป๋าลูกค้าหลังคำนวณสิทธิ์
// ถ้าได้ชิ้น: ใช้เศษที่คำนวณได้ (รวมการคืนค่าส่งเมื่อครบจำนวนส่งฟรีตามที่ออกแบบไว้)
// ถ้าไม่ได้ชิ้น: เก็บเฉพาะเงินที่ลูกค้าโอนจริง (กระเป๋าเดิม + สลิปนี้) ห้ามรวมค่าส่งที่บวกเพิ่มชั่วคราวตอนคำนวณ
// (แก้บั๊ก v1.0.7-v1.0.10: ลูกค้าที่จ่ายค่าส่งไปแล้ว โอนเพิ่มไม่พอซื้อ จะถูกบวกค่าส่งเข้ากระเป๋าเกินจริง)
function walletAfter(result, currentBalance) {
    return result.draws > 0 ? result.remainder : currentBalance;
}

function fmtBaht(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

module.exports = { MAX_DP_BUDGET, calculateBestDraws, calculateBestDrawsCore, describeTopup, walletAfter, fmtBaht };
