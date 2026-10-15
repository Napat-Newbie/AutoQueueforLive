const fs = require('fs');
const path = require('path');
const { 
    Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, 
    AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType 
} = require('docx');

const imgDir = path.join(__dirname, 'public', 'manual_images');

function readImg(filename) {
    return fs.readFileSync(path.join(imgDir, filename));
}

// Helpers
function p(text, options = {}) {
    const runs = typeof text === 'string' ? [new TextRun({ text, font: "TH Sarabun New", size: options.size || 28, bold: options.bold || false, italics: options.italics || false, color: options.color || "1E293B" })] : text;
    return new Paragraph({
        alignment: options.alignment || AlignmentType.LEFT,
        spacing: { before: options.before || 60, after: options.after || 80 },
        children: runs
    });
}

function h1(text) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
        children: [
            new TextRun({
                text,
                bold: true,
                size: 34,
                font: "TH Sarabun New",
                color: "1A73E8"
            })
        ]
    });
}

function h2(text) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        children: [
            new TextRun({
                text,
                bold: true,
                size: 30,
                font: "TH Sarabun New",
                color: "0F172A"
            })
        ]
    });
}

function h3(text) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 180, after: 80 },
        children: [
            new TextRun({
                text,
                bold: true,
                size: 28,
                font: "TH Sarabun New",
                color: "2563EB"
            })
        ]
    });
}

function bullet(title, desc) {
    return new Paragraph({
        spacing: { before: 40, after: 60 },
        indent: { left: 400 },
        children: [
            new TextRun({ text: "• " + title + ": ", bold: true, font: "TH Sarabun New", size: 28, color: "0F172A" }),
            new TextRun({ text: desc, font: "TH Sarabun New", size: 28, color: "334155" })
        ]
    });
}

function callout(title, text, type = 'info') {
    const bgColor = type === 'warning' ? "FEF3C7" : (type === 'success' ? "DCFCE7" : "EFF6FF");
    const borderColor = type === 'warning' ? "F59E0B" : (type === 'success' ? "22C55E" : "3B82F6");
    const titleColor = type === 'warning' ? "B45309" : (type === 'success' ? "15803D" : "1D4ED8");

    return new Table({
        width: { size: 9200, type: WidthType.DXA },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        width: { size: 9200, type: WidthType.DXA },
                        shading: { fill: bgColor, type: ShadingType.CLEAR },
                        margins: { top: 140, bottom: 140, left: 200, right: 200 },
                        children: [
                            new Paragraph({
                                spacing: { after: 60 },
                                children: [
                                    new TextRun({ text: title, bold: true, font: "TH Sarabun New", size: 28, color: titleColor })
                                ]
                            }),
                            new Paragraph({
                                children: [
                                    new TextRun({ text: text, font: "TH Sarabun New", size: 26, color: "334155" })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    });
}

function imgFigure(filename, caption, width = 620, height = 400) {
    return [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 80 },
            children: [
                new ImageRun({
                    data: readImg(filename),
                    transformation: { width, height }
                })
            ]
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
                new TextRun({
                    text: caption,
                    italics: true,
                    size: 24,
                    font: "TH Sarabun New",
                    color: "64748B"
                })
            ]
        })
    ];
}

function createTable(headers, rows, colWidths) {
    const tableRows = [];
    
    // Header Row
    const headerCells = headers.map((h, i) => new TableCell({
        width: { size: colWidths[i], type: WidthType.DXA },
        shading: { fill: "1E293B", type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: h, bold: true, color: "FFFFFF", font: "TH Sarabun New", size: 24 })]
        })]
    }));
    tableRows.push(new TableRow({ children: headerCells }));

    // Data Rows
    rows.forEach((row, rowIndex) => {
        const bg = (rowIndex % 2 === 1) ? "F8FAFC" : "FFFFFF";
        const cells = row.map((cellText, i) => new TableCell({
            width: { size: colWidths[i], type: WidthType.DXA },
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [new Paragraph({
                children: [new TextRun({ text: cellText, font: "TH Sarabun New", size: 24, color: "1E293B" })]
            })]
        }));
        tableRows.push(new TableRow({ children: cells }));
    });

    return new Table({
        rows: tableRows,
        width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA }
    });
}

// =========================================================================
// 1. GENERATE OPERATOR EDITION (เล่มแม่ค้า & แอดมินคุมไลฟ์ - ตัดส่วน Dev 100%)
// =========================================================================
function buildOperatorManual() {
    return new Document({
        creator: "AutoQueue for Live Team",
        title: "คู่มือการใช้งานระบบ AutoQueue for Live (ฉบับแม่ค้า & แอดมินคุมไลฟ์)",
        description: "คู่มือปฏิบัติงานหน้าร้าน จัดการคิวไลฟ์สด ตรวจสลิป และส่งของ Kerry Express (ไม่มีศัพท์เทคนิค ใช้งานได้ทันที)",
        sections: [{
            properties: {
                page: {
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            children: [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 80 },
                    children: [
                        new TextRun({
                            text: "📖 คู่มือการใช้งานระบบ AutoQueue for Live",
                            bold: true,
                            size: 44,
                            font: "TH Sarabun New",
                            color: "1A73E8"
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 120 },
                    children: [
                        new TextRun({
                            text: "【 ฉบับแม่ค้า & แอดมินคุมไลฟ์สด (Operator Edition) 】",
                            bold: true,
                            size: 32,
                            font: "TH Sarabun New",
                            color: "15803D"
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 280 },
                    children: [
                        new TextRun({
                            text: "เน้นการใช้งานจริงหน้ากล้อง: การรันคิว, ตรวจสลิป, สรุปยอดขาย และพิมพ์ใบปะหน้า Kerry Express (อ่านจบใน 5 นาที)",
                            size: 26,
                            font: "TH Sarabun New",
                            color: "475569"
                        })
                    ]
                }),

                callout("🌸 ยินดีต้อนรับสู่ระบบ AutoQueue for Live!",
                    "ระบบนี้ถูกออกแบบมาเพื่อช่วยให้แม่ค้าไลฟ์สดได้อย่างสบายใจ ไม่ต้องมีสมุดจด ไม่ต้องคอยดูสลิปเองทีละใบ ระบบจะตรวจเช็กเงินโอนจากลูกค้าผ่าน LINE โดยอัตโนมัติ รันคิวขึ้นจอให้แบบเรียลไทม์ และเตรียมไฟล์สำหรับพิมพ์ใบปะหน้าพัสดุ Kerry Express ได้ในคลิกเดียวครับ",
                    "success"
                ),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 1: ขั้นตอนเตรียมตัวก่อนเริ่มไลฟ์ (3 นาทีพร้อมขาย)"),
                p("ก่อนเปิดกล้องไลฟ์สด ให้แม่ค้าหรือแอดมินตรวจเช็กและตั้งค่ารายการสินค้าที่กล่อง '📦 รายการสินค้าและราคา' บนหน้าจอหลัก:"),
                bullet("1. กำหนดสินค้าและราคา", "กดปุ่ม '➕ เพิ่มสินค้า' แล้วพิมพ์ชื่อสินค้าในช่องซ้าย และราคาขายต่อชิ้นในช่องขวา (เช่น กล่องสุ่ม A : 189 บาท) หากมีหลายชิ้น สามารถกดเพิ่มแถวได้ตามต้องการ"),
                bullet("2. ตั้งค่าส่ง & ส่งฟรี", "ใส่ค่าส่งในช่อง '🚚 ค่าส่ง' (เช่น 40 บาท) และใส่จำนวนชิ้นในช่อง '🆓 ส่งฟรีเมื่อ(ชิ้น)' (เช่น 3 ชิ้นส่งฟรี หากไม่มีโปรโมชั่นให้ใส่ 0)"),
                bullet("3. ชื่อบัญชีร้านค้า", "ระบุชื่อบัญชีธนาคารในช่อง '🏦 ชื่อบัญชีร้าน' เพื่อให้ระบบช่วยเช็กว่าสลิปโอนเข้าบัญชีร้านเราจริง ป้องกันลูกค้าโอนผิด"),
                bullet("4. กดบันทึก", "เมื่อกรอกครบแล้ว กดปุ่มสีน้ำเงิน '💾 บันทึก' ระบบจะขึ้นข้อความ '✅ บันทึกแล้ว!'"),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 2: สารบัญอธิบาย 'ปุ่มกดที่แม่ค้าต้องใช้ทั้งหมด' ในระบบ"),
                p("ตารางด้านล่างนี้สรุปหน้าที่ของทุกปุ่มที่แม่ค้าและแอดมินต้องใช้งานระหว่างไลฟ์สด เพื่อให้เข้าใจง่ายและไม่กดผิดพลาด:"),

                h2("1. แถบควบคุมด้านบนสุด"),
                createTable(
                    ["ปุ่ม / สัญลักษณ์", "สี / รูปร่าง", "หน้าที่การทำงาน และผลลัพธ์เมื่อกด"],
                    [
                        ["▶️ เริ่มไลฟ์สด", "ปุ่มสีเขียวสด", "กดเมื่อพร้อมเปิดกล้อง ระบบจะตรวจเช็กเครดิต API ให้ก่อนเริ่ม, เริ่มจับเวลา, ล็อกไม่ให้หน้าจอคอมดับ, และเปลี่ยนปุ่มเป็นสีแดง"],
                        ["⏱️ 00:00:00", "นาฬิกาสีดำ/เขียว", "แสดงระยะเวลาที่ไลฟ์สดอยู่จริง ช่วยให้แม่ค้าบริหารเวลาได้อย่างแม่นยำ"],
                        ["🌐 LINE Webhook Pill", "ป้ายสีเขียวกลมมน", "แสดงสถานะการเชื่อมต่อกับ LINE OA หากเป็นสีเขียวแปลว่าบอทพร้อมรับสลิป คลิกเพื่อดูลิงก์หรือกดปุ่มทดสอบส่งสัญญาณ (Ping)"],
                        ["⚡ เครดิต API Pill", "ป้ายสีฟ้า/ส้ม", "แสดงจำนวนเครดิตตรวจสลิปคงเหลือ หากเครดิตหมด ระบบจะสลับไปโหมดสำรองตรวจมืออัตโนมัติทันทีโดยไม่ออเดอร์หลุด"],
                        ["⏹️ จบไลฟ์สด", "ปุ่มสีแดง (จะแสดงเมื่อเริ่มไลฟ์)", "กดเมื่อไลฟ์เสร็จสิ้น ระบบจะหยุดตัวจับเวลา และบันทึกประวัติรอบไลฟ์ลงระบบถาวร"],
                        ["📦 Export Kerry Excel", "ปุ่มสีส้ม Kerry", "กดเพื่อเปิดหน้าต่างตรวจสอบความพร้อมของที่อยู่ลูกค้า และดาวน์โหลดไฟล์สำหรับนำเข้า Kerry เพื่อพิมพ์ใบปะหน้า"]
                    ],
                    [2200, 2200, 4800]
                ),

                new Paragraph({ spacing: { after: 150 } }),

                h2("2. กล่องรายการสินค้าและค่าจัดส่ง"),
                createTable(
                    ["ปุ่ม / ช่องกรอก", "ประเภท", "หน้าที่การทำงาน"],
                    [
                        ["➕ เพิ่มสินค้า", "ปุ่มสีเขียว", "กดเพื่อเพิ่มแถวสินค้าใหม่สำหรับใส่ชื่อและราคา"],
                        ["❌ ลบ", "ปุ่มสีแดงขอบบาง", "กดเพื่อลบแถวสินค้านั้นออกจากระบบ"],
                        ["💾 บันทึก", "ปุ่มสีน้ำเงิน", "กดเพื่อบันทึกราคาสินค้า, ค่าส่ง, เงื่อนไขส่งฟรี และชื่อบัญชีร้าน"]
                    ],
                    [2200, 2000, 5000]
                ),

                new Paragraph({ spacing: { after: 150 } }),

                h2("3. กระดานคิวและปุ่มบนการ์ดลูกค้า (Queue Action Buttons)"),
                p("กระดานคิวถูกแบ่งออกเป็น 4 กระดานชัดเจนตามแถบสีด้านซ้าย:"),
                createTable(
                    ["กระดานคิว / ปุ่มกด", "แถบสีประจำกระดาน", "การทำงาน และขั้นตอนที่แม่ค้าต้องปฏิบัติ"],
                    [
                        ["🎮 คิวที่กำลังเล่น (Active)", "แถบสีน้ำเงิน", "แสดงลูกค้าที่แม่ค้ากำลังพูดคุยหรือเล่นกิจกรรมอยู่หน้ากล้องขณะนี้"],
                        ["  • ปุ่ม '✅ เสร็จสิ้น'", "ปุ่มสีเขียวในการ์ด", "กดเมื่อเปิดกล่องหรือสรุปของให้ลูกค้ารายนี้เสร็จสิ้นแล้ว คิวจะถูกบันทึกสำเร็จและนำออกจากจอ"],
                        ["  • ปุ่ม '⏭️ ข้าม'", "ปุ่มสีเหลืองในการ์ด", "กดเมื่อลูกค้าในคิวนี้ไม่อยู่หรือยังไม่ตอบ เพื่อส่งการ์ดไปพักไว้ในกระดาน Skipped ชั่วคราว"],
                        ["📋 คิวที่กำลังรอ (Waiting)", "แถบสีเขียว", "แสดงรายชื่อลูกค้าที่โอนเงินสำเร็จแล้วและกำลังต่อแถวรอเล่นกิจกรรม เรียงตามลำดับ #1, #2, #3..."],
                        ["  • ปุ่ม '📢 เรียกคิว'", "ปุ่มสีน้ำเงินในการ์ด", "กดเพื่อเรียกลูกค้าคนนี้ขึ้นมาเล่นกิจกรรม การ์ดจะย้ายขึ้นไปอยู่กระดาน Active ทันที"],
                        ["  • ปุ่ม '⏭️ ข้าม'", "ปุ่มสีเหลืองในการ์ด", "กดเพื่อข้ามคิวนี้ไปก่อน"],
                        ["  • ปุ่ม '❌ ยกเลิก'", "ปุ่มสีแดงขอบบาง", "กดเพื่อยกเลิกออเดอร์ของลูกค้ารายนี้ (ระบบจะหักยอดเงินและสิทธิ์คืนทันที)"],
                        ["  • ปุ่ม '🗑️ ล้างคิวทั้งหมด'", "ปุ่มสีแดงหัวกระดาน", "กดเมื่อต้องการลบคิวที่ค้างอยู่ในกระดานรอทั้งหมดออกจากจอ"],
                        ["  • ปุ่ม '🔍 เช็คสลิปและใส่ยอด'", "ปุ่มสีส้มในการ์ด", "จะปรากฏขึ้นเมื่อลูกค้าส่งสลิปไม่มี QR Code กดเพื่อเปิดดูรูปสลิปและพิมพ์ยอดเงิน"],
                        ["⏭️ คิวที่ถูกข้ามไป (Skipped)", "แถบสีแดง", "รวบรวมลูกค้าที่ถูกกดข้ามไว้ เพื่อไม่ให้เสียสิทธิ์การเล่น"],
                        ["  • ปุ่ม '📢 เรียกคิวอีกครั้ง'", "ปุ่มสีน้ำเงินในการ์ด", "เมื่อลูกค้ากลับมาดูไลฟ์สดแล้ว ให้กดปุ่มนี้เพื่อดึงคิวกลับขึ้นมาเล่นกิจกรรม"],
                        ["  • ปุ่ม '❌ ยกเลิกคิว'", "ปุ่มสีแดงขอบบาง", "กดยกเลิกคิวและหักยอดออกหากลูกค้าสละสิทธิ์"],
                        ["📝 สลิปผิดปกติ (Abnormal)", "แถบสีส้ม", "แสดงสลิปที่ยอดเงินไม่ตรง หรือสลิปที่รอตรวจสอบความถูกต้องหลังจบไลฟ์"],
                        ["  • ปุ่ม '✅ ถูกต้อง (รวมยอด)'", "ปุ่มสีเขียวในการ์ด", "กดยืนยันเมื่อแม่ค้าเช็กบัญชีธนาคารแล้วพบว่าเงินเข้าจริง"],
                        ["  • ปุ่ม '❌ ไม่ถูกต้อง (ปัดตก)'", "ปุ่มสีแดงในการ์ด", "กดปัดตกเมื่อพบว่าเป็นสลิปปลอมหรือเงินไม่เข้าจริง"]
                    ],
                    [2500, 2000, 4700]
                ),

                new Paragraph({ spacing: { after: 150 } }),

                h2("4. หน้าต่างตรวจสอบภาพสลิปจริง (Manual Slip Modal)"),
                ...imgFigure("05_manual_slip_modal.png", "ภาพที่ 1: หน้าต่างตรวจสอบภาพสลิปจริง (สำหรับสลิปไม่มี QR หรือโหมดตรวจมือ)", 580, 380),
                createTable(
                    ["ปุ่ม / ช่องกรอก", "ลักษณะ", "หน้าที่การทำงาน"],
                    [
                        ["รูปสลิปตรงกลาง", "ภาพขยายชัดเจน", "แสดงรูปสลิปต้นฉบับที่ลูกค้าส่งมา เพื่อให้แม่ค้าดูยอดเงินและชื่อผู้รับ"],
                        ["ช่อง 'กรอกยอดเงินที่โอนจริง'", "ช่องพิมพ์ตัวเลข", "ดูยอดเงินจากรูปแล้วพิมพ์ตัวเลขลงในช่องนี้ (เช่น 189 หรือ 378)"],
                        ["✅ ยืนยันยอดเงิน", "ปุ่มสีเขียว", "กดเพื่อยืนยันยอด ระบบจะคำนวณจำนวนชิ้นสินค้าให้อัตโนมัติ และย้ายคิวเข้าสู่กระดาน Waiting ทันที"],
                        ["❌ รูปนี้ไม่ใช่สลิป (ปัดตก)", "ปุ่มสีแดง", "กดเมื่อลูกค้าส่งรูปที่ไม่ใช่สลิป (เช่น ส่งรูปสินค้า หรือสติกเกอร์) เพื่อลบคิวนี้ทิ้งทันที"]
                    ],
                    [2500, 2000, 4700]
                ),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 3: ขั้นตอนปฏิบัติจริงระหว่างไลฟ์สด (จับมือทำทีละ Step)"),
                ...imgFigure("01_live_dashboard.png", "ภาพที่ 2: หน้าจอแดชบอร์ดหลักขณะกำลังไลฟ์สดจริง พร้อมตัวจับเวลาและคิวลูกค้า", 620, 420),

                h2("สเต็ป 1: กดปุ่ม '▶️ เริ่มไลฟ์สด'"),
                p("เมื่อเปิดกล้องพร้อมไลฟ์ ให้คลิกปุ่มสีเขียว '▶️ เริ่มไลฟ์สด' ตัวจับเวลาจะเริ่มนับ และระบบจะล็อกไม่ให้หน้าจอคอมดับตลอดการไลฟ์"),

                h2("สเต็ป 2: ลูกค้าโอนเงินและส่งสลิปเข้า LINE"),
                p("เมื่อลูกค้าส่งสลิปเข้าห้องแชท LINE Official Account ของร้าน:"),
                bullet("ระบบตรวจอัตโนมัติ 1-3 วินาที", "ระบบจะตรวจสอบรหัสธุรกรรม ยอดเงิน และชื่อบัญชีร้านค้าทันที"),
                bullet("เสียงแจ้งเตือนและคิวเด้งขึ้นจอ", "เมื่อสลิปถูกต้อง จะมีเสียงกระดิ่งแจ้งเตือนดังขึ้นในคอม และการ์ดคิวของลูกค้าจะเด้งเข้าไปอยู่ในกระดาน '📋 คิวที่กำลังรอ (Waiting)' โดยอัตโนมัติ"),
                bullet("ลูกค้าโอนเพิ่ม (Smart Merge)", "หากลูกค้ารายเดิมโอนเงินเพิ่มระหว่างรอคิว ระบบจะนำยอดและจำนวนชิ้นไป 'ทบเข้าการ์ดคิวเดิมทันที' ไม่แตกคิวใหม่ ไม่ทำให้เสียลำดับเดิม!"),

                h2("สเต็ป 3: เรียกลูกค้าขึ้นมาเล่นกิจกรรม (📢 เรียกคิว)"),
                p("เมื่อพร้อมเรียกลูกค้าคิวถัดไป ให้กดปุ่มสีน้ำเงิน '📢 เรียกคิว' ที่การ์ดลูกค้าคนแรก คิวจะวิ่งขึ้นไปอยู่ในกระดานสีน้ำเงิน '🎮 คิวที่กำลังเล่นกิจกรรม (Active)' ทันที"),

                h2("สเต็ป 4: เมื่อเล่นกิจกรรมเสร็จสิ้น (✅ เสร็จสิ้น)"),
                p("เมื่อเปิดกล่องหรือสรุปสินค้าให้ลูกค้ารายนี้เสร็จสิ้นแล้ว ให้กดปุ่มสีเขียว '✅ เสร็จสิ้น' คิวจะถูกบันทึกสำเร็จและนำออกจากหน้าจออย่างเป็นระเบียบ"),

                h2("สเต็ป 5: หากลูกค้าไม่อยู่หน้าจอ (⏭️ ข้าม)"),
                p("หากแม่ค้าเรียกชื่อลูกค้าแล้วลูกค้ายังไม่ตอบ ให้กดปุ่มสีเหลือง '⏭️ ข้าม' การ์ดจะย้ายไปพักไว้ในกระดานสีแดง เมื่อลูกค้ากลับมาทักในไลฟ์ ให้กด '📢 เรียกคิวอีกครั้ง' เพื่อดึงกลับมาเล่นได้ทันที"),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 4: ขั้นตอนหลังจบไลฟ์ & สั่งพิมพ์ใบปะหน้า Kerry Express"),
                ...imgFigure("04_kerry_export_modal.png", "ภาพที่ 3: หน้าต่างสรุปข้อมูลพัสดุ Kerry Express พร้อมปุ่มดาวน์โหลดไฟล์ Excel", 580, 380),

                h2("สเต็ป 4.1: กดปุ่มสีแดง '⏹️ จบไลฟ์สด'"),
                p("คลิกที่ปุ่ม '⏹️ จบไลฟ์สด' เพื่อบันทึกเวลาสิ้นสุดรอบไลฟ์ และสรุปยอดขายทั้งหมดของรอบนั้นเข้าสู่ประวัติ"),

                h2("สเต็ป 4.2: ตรวจสอบกระดาน 'สลิปผิดปกติ' (ถ้ามี)"),
                p("หากมีสลิปอยู่ในกระดานสีส้ม ให้เปิดแอปธนาคารของร้านตรวจเช็กดูยอด:"),
                bullet("หากเงินเข้าจริง", "กดปุ่ม '✅ ถูกต้อง (รวมยอด)' ระบบจะรวมยอดและปิดงานให้"),
                bullet("หากเงินไม่เข้าจริง", "กดปุ่ม '❌ ไม่ถูกต้อง (ปัดตก)' เพื่อตัดยอดทิ้ง"),

                h2("สเต็ป 4.3: ดาวน์โหลดไฟล์ Kerry Excel"),
                bullet("1. เปิดหน้าต่าง", "กดปุ่มสีส้ม '📦 Export Kerry Excel' ที่มุมขวาบน"),
                bullet("2. ตรวจสอบที่อยู่", "ระบบ Gemini AI จะดึงชื่อ ที่อยู่ เบอร์โทร จากแชท LINE ของลูกค้ามาจัดเรียงให้อัตโนมัติ (หากมีลูกค้าคนไหนยังไม่ส่งที่อยู่ จะมีชื่อแสดงในกล่องสีแดงเพื่อให้แอดมินตามทัก)"),
                bullet("3. ดาวน์โหลดไฟล์", "กดปุ่ม '📥 ดาวน์โหลดไฟล์ Excel (Kerry)' จะได้ไฟล์ Excel บันทึกลงในเครื่องคอมพิวเตอร์"),

                h2("สเต็ป 4.4: นำไฟล์เข้าเว็บ Kerry EasyShip (พิมพ์ใบปะหน้า 1 คลิก)"),
                bullet("1. เข้าสู่ระบบ", "เปิดเว็บ Kerry Express EasyShip (https://easyship.kerryexpress.com)"),
                bullet("2. เลือกเมนู", "ไปที่เมนู 'สร้างรายการพัสดุ' -> เลือก 'สร้างพัสดุหลายรายการ (Bulk Upload / นำเข้าไฟล์ Excel)'"),
                bullet("3. อัปโหลดไฟล์", "เลือกไฟล์ Excel ที่ดาวน์โหลดมาจากระบบของเรา"),
                bullet("4. พิมพ์ใบปะหน้า", "ข้อมูลลูกค้าทุกคนจะแสดงขึ้นมาทันที ตรวจสอบความถูกต้องและกด 'สั่งพิมพ์ใบปะหน้าพัสดุ' ได้ทันที ไม่ต้องพิมพ์ที่อยู่เองแม้แต่คนเดียว!"),

                new Paragraph({ spacing: { after: 300 } }),

                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "🎉 ขอให้ไลฟ์สดอย่างมีความสุข ยอดขายปังๆ ปิดยอดไว และจัดส่งราบรื่นทุกออเดอร์ครับ! 🎉",
                            bold: true,
                            size: 30,
                            font: "TH Sarabun New",
                            color: "1A73E8"
                        })
                    ]
                })
            ]
        }]
    });
}

// =========================================================================
// 2. GENERATE ADMIN & TECHNICAL EDITION (เล่มเจ้าของร้าน & ช่างเทคนิค)
// =========================================================================
function buildAdminTechnicalManual() {
    return new Document({
        creator: "AutoQueue for Live Team",
        title: "คู่มือการติดตั้งและการตั้งค่าระบบ AutoQueue for Live (ฉบับเจ้าของร้าน & ผู้ดูแลระบบ)",
        description: "คู่มือการติดตั้ง เชื่อมต่อ API Keys, ฐานข้อมูล SQLite, ความปลอดภัย, และการกู้คืนระบบฉุกเฉิน",
        sections: [{
            properties: {
                page: {
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            children: [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 80 },
                    children: [
                        new TextRun({
                            text: "🔧 คู่มือการติดตั้งและการตั้งค่าระบบ AutoQueue for Live",
                            bold: true,
                            size: 44,
                            font: "TH Sarabun New",
                            color: "1E293B"
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 120 },
                    children: [
                        new TextRun({
                            text: "【 ฉบับเจ้าของร้าน & ผู้ดูแลระบบ (Store Owner & Technical Admin) 】",
                            bold: true,
                            size: 30,
                            font: "TH Sarabun New",
                            color: "DC2626"
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 280 },
                    children: [
                        new TextRun({
                            text: "ครอบคลุมการตั้งค่า API Keys, การเชื่อมต่อ Provider 6 ค่าย, ฐานข้อมูล SQLite, การสำรองข้อมูล และรหัสผ่านกู้คืนระบบฉุกเฉิน",
                            size: 26,
                            font: "TH Sarabun New",
                            color: "64748B"
                        })
                    ]
                }),

                callout("🔒 เอกสารลับเฉพาะเจ้าของร้านและผู้ดูแลระบบ",
                    "เอกสารฉบับนี้มีข้อมูลการตั้งค่าความปลอดภัย บัญชี API Token และรหัสผ่าน Master Key กู้คืนระบบฉุกเฉิน กรุณาเก็บรักษาเป็นความลับ และไม่ส่งต่อให้บุคคลภายนอกหรือพนักงานทั่วไป",
                    "warning"
                ),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 1: สถาปัตยกรรมระบบและความปลอดภัย (System Architecture)"),
                p("AutoQueue for Live ทำงานบน Node.js และ SQLite ภายในเครื่อง (Local Embedded Database) เพื่อความปลอดภัยสูงสุด:"),
                bullet("ฐานข้อมูล Local SQLite", "ข้อมูลออเดอร์ ชื่อลูกค้า เบอร์โทร และยอดเงินทั้งหมดถูกเก็บในไฟล์ 'orders.sqlite' บนเครื่องคอมพิวเตอร์ของร้านค้า ไม่มีการส่งข้อมูลส่วนบุคคลออกไปเก็บยัง Cloud Server ภายนอก"),
                bullet("ระบบตรวจสอบสลิปแบบ Multi-Provider Adapter", "ระบบรองรับการตรวจสลิปผ่าน 6 ทางเลือก พร้อมกลไก Fallback อัตโนมัติ หาก API เกิดข้อผิดพลาดหรือเครดิตหมด สลิปจะถูกส่งเข้าคิวแบบ Manual ทันทีเพื่อไม่ให้สะดุดหน้าไลฟ์"),

                new Paragraph({ spacing: { after: 150 } }),

                h1("บทที่ 2: การเข้าสู่ระบบตั้งค่า & รหัสผ่านร้านค้า"),
                ...imgFigure("02_first_time_login.png", "ภาพที่ 1: หน้าต่างกำหนดรหัสผ่านร้านค้าครั้งแรก", 600, 360),
                bullet("การตั้งรหัสผ่านครั้งแรก", "เมื่อกดปุ่ม '🔑 ตั้งค่าระบบ (Setup)' ระบบจะให้ตั้งรหัสผ่านประจำร้าน (อย่างน้อย 4 ตัวอักษร) เพื่อป้องกันไม่ให้ผู้อื่นเข้ามาดู API Token หรือล้างข้อมูลร้าน"),
                bullet("การล็อกอินครั้งถัดไป", "กรอกรหัสผ่านที่ตั้งไว้เพื่อปลดล็อกหน้า Setup Wizard"),

                callout("🔑 รหัสผ่านฉุกเฉินสำหรับผู้พัฒนา/กู้คืนระบบ (Emergency Master Key)",
                    "หากเจ้าของร้านลืมรหัสผ่านประจำร้าน สามารถใช้รหัสผ่าน Master Recovery Key: 0817342899 เพื่อเข้าสู่ระบบและรีเซ็ตรหัสผ่านใหม่ในแท็บ '🔒 เปลี่ยนรหัสผ่านร้านค้า' ได้ทันที",
                    "warning"
                ),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 3: การเชื่อมต่อ API Keys & ผู้ให้บริการตรวจสลิป 6 ทางเลือก"),
                ...imgFigure("03_setup_wizard_providers.png", "ภาพที่ 2: หน้าต่าง Setup Wizard พร้อมตัวเลือก Provider 6 ทางเลือกและโลโก้จริง", 600, 420),

                h2("1. LINE Channel Access Token"),
                p("นำ Access Token จาก LINE Developers Console (Messaging API Channel) มาวางในช่องนี้ เพื่อให้ระบบส่งข้อความอัตโนมัติไปยังลูกค้า:"),
                bullet("ข้อความตอบกลับเมื่อสลิปผ่าน", "แจ้งหมายเลขคิว, สรุปยอดเงิน, และขอชื่อ-ที่อยู่จัดส่ง"),
                bullet("ข้อความตอบกลับเมื่อสลิปซ้ำ", "แจ้งเตือนว่าสลิปนี้เคยใช้งานไปแล้ว ป้องกันการโกง"),

                h2("2. Google Gemini API Key"),
                p("ระบบใส่ค่ามาตรฐานความเร็วและความแม่นยำสูงไว้ให้อัตโนมัติ (ห้ามลบ) สำหรับรันโมเดล Gemini AI สกัดที่อยู่ลูกค้าเป็นคอลัมน์ Kerry Excel"),

                h2("3. รายละเอียดการตั้งค่า Provider ตรวจสลิปทั้ง 6 ค่าย"),
                bullet("1) SlipOK", "กรอก Secret API Key และ Branch ID ที่ได้จากแดชบอร์ด SlipOK"),
                bullet("2) EasySlip", "กรอก Authorization Token (Bearer Token) จาก EasySlip"),
                bullet("3) Thunder Solution", "กรอก API Key จากระบบ Thunder Solution"),
                bullet("4) SlipVerify", "กรอก Token สำหรับเชื่อมต่อ SlipVerify API"),
                bullet("5) Custom API", "กรอก Endpoint URL ของเซิร์ฟเวอร์ตรวจสลิปตนเอง พร้อม Auth Header"),
                bullet("6) ตรวจสลิปเอง (Manual Free 100%)", "เปิดใช้งานโหมดนี้เมื่อไม่ต้องการเสียค่าบริการ API รายเดือน สลิปจะถูกส่งเข้าให้แอดมินพิมพ์ยอดเงินเองหน้าจอ"),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 4: การสำรองฐานข้อมูล & System Error Logs"),
                h2("การสำรองฐานข้อมูล (Database Backup & Restore)"),
                p("ในแท็บ '💾 สำรองฐานข้อมูล (Backup)':"),
                bullet("ดาวน์โหลดไฟล์ Backup", "กดปุ่ม '📥 ดาวน์โหลดไฟล์ฐานข้อมูล (.sqlite)' เพื่อบันทึกสำเนาข้อมูลยอดขายและลูกค้าเก็บไว้ใน Flash Drive หรือไดรฟ์อื่น"),
                bullet("กู้คืนฐานข้อมูล", "สามารถนำไฟล์ .sqlite เดิมมาวางทับเพื่อกู้คืนข้อมูลประวัติการขายทั้งหมดได้ทันที"),

                h2("การตรวจสอบ System & Error Logs"),
                p("ในแท็บ '📜 System & Error Logs' ระบบจะบันทึกประวัติการเรียก API และข้อผิดพลาดทางเทคนิคทั้งหมด:"),
                bullet("กรณี API Error", "จะแสดง HTTP Status Code และข้อความตอบกลับจากเซิร์ฟเวอร์ Provider ช่วยให้ทราบเมื่อเครดิตหมดหรือ Token ไม่ถูกต้อง"),
                bullet("กรณี Duplicate Slip", "บันทึกข้อมูลธุรกรรมที่ลูกค้าพยายามส่งสลิปซ้ำ พร้อม User ID ของผู้ส่ง"),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 5: ระบบท่อเชื่อมต่ออัจฉริยะ (Dual-Engine) & ป้องกันเครดิตหมด (Zero-Drop)"),
                h2("1. ระบบท่อส่งสัญญาณ Dual-Engine Tunneling (แก้ Risk 1)"),
                p("เพื่อแก้ปัญหาการเชื่อมต่อ Webhook หลุด หรือปัญหาแม่ค้านำโปรแกรมไปติดตั้งที่เครื่องใหม่แล้วใช้งานไม่ได้:"),
                bullet("เครื่องยนต์หลัก (Cloudflare Quick Tunnel)", "โปรแกรมจะเรียกใช้ cloudflared.exe เพื่อสร้างท่อสัญญาณ HTTPS (https://*.trycloudflare.com) ที่เสถียรและรวดเร็ว"),
                bullet("เครื่องยนต์สำรอง (LocalTunnel Pure Node.js)", "หากเครื่องของแม่ค้าไม่มี cloudflared.exe หรือ Cloudflare ขัดข้อง ระบบจะสลับไปเปิด LocalTunnel ทันทีอัตโนมัติ โดยไม่ต้องมีไฟล์ภายนอกเพิ่มเติม"),
                bullet("ระบบ Auto-Sync LINE Webhook (Zero-Click)", "เมื่อได้ URL สาธารณะแล้ว ระบบจะส่งคำขอ PUT ไปยัง LINE Messaging API เพื่อผูก Webhook ให้โดยอัตโนมัติทันที แม่ค้าไม่ต้องไปเปิดเว็บ LINE Developers อีกต่อไป"),
                bullet("ปุ่มทดสอบส่งสัญญาณ (Ping Webhook)", "ในหน้าจอหลัก แม่ค้าสามารถคลิกที่ป้าย Webhook เพื่อกดปุ่ม '🔄 ทดสอบส่งสัญญาณ LINE' เพื่อตรวจเช็กการตอบกลับ 200 OK ได้ทันที"),

                h2("2. ระบบป้องกันเครดิตตรวจสลิปหมดกลางไลฟ์ (ป้องกัน Risk 2)"),
                p("ป้องกันปัญหาเครดิต API หมดแล้วออเดอร์สะดุดหรือหลุดหาย:"),
                bullet("การตรวจเช็กเครดิตแบบเรียลไทม์", "ระบบเชื่อมต่อ API ของผู้ให้บริการ (เช่น SlipOK / EasySlip) ตรวจสอบยอดเครดิตคงเหลือ และแสดงผลบนหน้าจอหลักแบบเรียลไทม์"),
                bullet("ระบบเตือนก่อนเริ่มไลฟ์ (Pre-Live Safety Check)", "เมื่อกดปุ่มเริ่มไลฟ์สด ระบบจะตรวจสอบเครดิต หากพบว่าเครดิตหมดหรือเหลือน้อย จะมีหน้าต่างแจ้งเตือนทันท่วงที"),
                bullet("กลไกสำรองตรวจมืออัตโนมัติ (Zero-Drop Fallback)", "หากเครดิตหมดขณะที่กำลังไลฟ์สด ระบบจะไม่ปฏิเสธลูกค้า แต่จะตอบกลับอย่างสุภาพ และนำภาพสลิปส่งเข้ากระดาน Waiting ให้แม่ค้ากดดูรูปและยืนยันยอดเงินเองได้ทันที 100% ออเดอร์ไม่หลุดหายแน่นอน"),

                new Paragraph({ spacing: { after: 200 } }),

                h1("บทที่ 6: การล้างข้อมูลทดสอบก่อนส่งมอบระบบ (System Reset)"),
                p("ในแท็บ '🧹 ล้างข้อมูลทดสอบ (Reset)':"),
                bullet("ปุ่ม '⚠️ ล้างประวัติยอดขายและคิวทดสอบ'", "ใช้สำหรับเคลียร์คิวทดสอบและรีเซ็ตยอดขายทั้งหมดให้เป็น 0 ก่อนเริ่มใช้งานจริง โดยจะไม่ลบการตั้งค่า API Keys หรือรหัสผ่านร้านค้า"),

                new Paragraph({ spacing: { after: 300 } }),

                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "🔧 ระบบ AutoQueue for Live ได้รับการออกแบบให้เสถียรและดูแลรักษาง่าย พร้อมทำงานตลอด 24 ชั่วโมง 🔧",
                            bold: true,
                            size: 28,
                            font: "TH Sarabun New",
                            color: "1E293B"
                        })
                    ]
                })
            ]
        }]
    });
}

// Build and save both documents
console.log("Generating Split Manuals...");

const opDoc = buildOperatorManual();
Packer.toBuffer(opDoc).then(buf => {
    const opPath = path.join(__dirname, 'User_Manual_Operator_Edition.docx');
    fs.writeFileSync(opPath, buf);
    console.log('Successfully generated Operator Manual at:', opPath);

    const brainOp = 'C:\\Users\\napat\\.gemini\\antigravity\\brain\\82c1fccc-253f-4df2-a685-20e6068f9a40\\User_Manual_Operator_Edition.docx';
    fs.copyFileSync(opPath, brainOp);
    console.log('Copied Operator Manual to brain directory!');
});

const adminDoc = buildAdminTechnicalManual();
Packer.toBuffer(adminDoc).then(buf => {
    const adminPath = path.join(__dirname, 'User_Manual_Admin_Technical_Edition.docx');
    fs.writeFileSync(adminPath, buf);
    console.log('Successfully generated Admin & Technical Manual at:', adminPath);

    const brainAdmin = 'C:\\Users\\napat\\.gemini\\antigravity\\brain\\82c1fccc-253f-4df2-a685-20e6068f9a40\\User_Manual_Admin_Technical_Edition.docx';
    fs.copyFileSync(adminPath, brainAdmin);
    console.log('Copied Admin Manual to brain directory!');
});
