const fs = require('fs');
const path = require('path');
const { 
    Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, 
    AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType 
} = require('docx');

const imgDir = path.join(__dirname, 'public', 'manual_images');

function readImg(filename) {
    const fullPath = path.join(imgDir, filename);
    if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath);
    }
    return null;
}

// Helpers for clean styling
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
        spacing: { before: 360, after: 140 },
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
        spacing: { before: 260, after: 100 },
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

function imgFigure(filename, caption, width = 600, height = 380) {
    const imgData = readImg(filename);
    if (!imgData) return [];
    return [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 80 },
            children: [
                new ImageRun({
                    data: imgData,
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

function buildOperatorManualDoc() {
    return new Document({
        creator: "AutoQueue for Live Team",
        title: "คู่มือการใช้งานระบบ AutoQueue for Live (ฉบับผู้ใช้งาน & แอดมินคุมไลฟ์สด)",
        description: "คู่มือปฏิบัติงานหน้าร้าน จัดการคิวไลฟ์สด ตรวจสลิป และส่งของ Kerry Express (ไม่มีศัพท์เทคนิค มือใหม่เข้าใจง่าย 100%)",
        sections: [{
            properties: {
                page: {
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            children: [
                // Header Title
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
                            text: "【 ฉบับผู้ใช้งาน & แอดมินคุมไลฟ์สด (Operator Edition) 】",
                            bold: true,
                            size: 32,
                            font: "TH Sarabun New",
                            color: "15803D"
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 240 },
                    children: [
                        new TextRun({
                            text: "คู่มือจับมือทำสำหรับมือใหม่: ตั้งแต่เริ่มเปิดโปรแกรม คุมคิวหน้ากล้อง ตรวจสลิปอัตโนมัติ จนถึงสั่งพิมพ์ใบปะหน้า Kerry Express (อ่านจบใน 5 นาที)",
                            size: 26,
                            font: "TH Sarabun New",
                            color: "475569"
                        })
                    ]
                }),

                callout("🌸 ยินดีต้อนรับสู่ AutoQueue for Live!",
                    "ระบบนี้สร้างขึ้นเพื่อแม่ค้าและทีมงานไลฟ์สดโดยเฉพาะ ไม่ต้องใช้สมุดจด ไม่ต้องคอยก้มดูยอดเงินในมือถือทีละสลิป ระบบจะเชื่อมต่อกับ LINE Official Account ของร้านเพื่อตรวจสลิปอัตโนมัติ รันคิวขึ้นจอให้ทันที มีระบบทบยอดเมื่อลูกค้าโอนเพิ่ม และสรุปข้อมูลเตรียมพิมพ์ใบปะหน้า Kerry Express ได้ในคลิกเดียวครับ",
                    "success"
                ),

                new Paragraph({ spacing: { after: 200 } }),

                // บทที่ 1
                h1("บทที่ 1: การติดตั้งและเริ่มต้นใช้งานครั้งแรก (ภายใน 1 นาที)"),
                p("สำหรับผู้เริ่มต้นใช้งาน ให้ทำตาม 3 ขั้นตอนง่ายๆ ดังนี้ครับ:"),
                bullet("ขั้นตอนที่ 1: ติดตั้งโปรแกรม", "ดับเบิลคลิกไฟล์ตัวติดตั้ง 'AutoQueueforLive_Setup.exe' ที่อยู่บนหน้าจอคอมพิวเตอร์ของคุณ แล้วกด Next ไปจนเสร็จสิ้น (ใช้เวลาไม่ถึง 20 วินาที)"),
                bullet("ขั้นตอนที่ 2: เปิดโปรแกรม", "เมื่อติดตั้งเสร็จแล้ว ดับเบิลคลิกไอคอนรูปกล่อง 'AutoQueueforLive' บนหน้าจอ Desktop เพื่อเปิดระบบ โปรแกรมจะเปิดหน้าจอควบคุมขึ้นมาให้อัตโนมัติ"),
                bullet("ขั้นตอนที่ 3: เข้าใช้งานครั้งแรก (สำหรับร้านค้า)", "หากเป็นการเข้าใช้งานครั้งแรก ระบบจะมีหน้าต่างให้แม่ค้ากำหนดรหัสผ่านของร้าน (เพื่อป้องกันไม่ให้ผู้อื่นเข้ามากดแก้ไขข้อมูลร้านค้า) เมื่อตั้งรหัสผ่านเสร็จแล้วจะเข้าสู่หน้าจอขายของได้ทันที"),

                ...imgFigure("02_first_time_login.png", "ภาพที่ 1: หน้าต่างเข้าสู่ระบบและตั้งรหัสผ่านสำหรับร้านค้า", 560, 340),

                new Paragraph({ spacing: { after: 200 } }),

                // บทที่ 2
                h1("บทที่ 2: การเตรียมพร้อมก่อนเปิดกล้องไลฟ์สด (ใช้เวลาเพียง 2 นาที)"),
                p("ก่อนเปิดกล้องไลฟ์สด ให้แม่ค้าหรือแอดมินตรวจเช็กและตั้งค่าที่กล่อง '📦 รายการสินค้าและราคา' บนหน้าจอหลัก:"),
                bullet("1. กำหนดสินค้าและราคา", "กดปุ่ม '➕ เพิ่มสินค้า' แล้วพิมพ์ชื่อสินค้าในช่องซ้าย และราคาขายในช่องขวา (เช่น 'กล่องสุ่ม A' : '189' บาท) สามารถเพิ่มได้หลายรายการตามที่ไลฟ์ขาย"),
                bullet("2. ตั้งค่าส่ง & โปรส่งฟรี", "ใส่ค่าส่งในช่อง '🚚 ค่าส่ง' (เช่น 40 บาท) และใส่จำนวนชิ้นในช่อง '🆓 ส่งฟรีเมื่อ(ชิ้น)' (เช่น 3 ชิ้นส่งฟรี หากไม่มีโปรโมชั่นให้ใส่เลข 0)"),
                bullet("3. ระบุชื่อบัญชีร้านค้า", "พิมพ์ชื่อบัญชีธนาคารในช่อง '🏦 ชื่อบัญชีร้าน' เพื่อให้ระบบช่วยเช็กว่าสลิปที่ลูกค้าส่งมาโอนเข้าบัญชีร้านเราจริง ป้องกันลูกค้าโอนผิดบัญชีหรือส่งสลิปเก่า"),
                bullet("4. กดบันทึก", "กดปุ่มสีน้ำเงิน '💾 บันทึก' ระบบจะขึ้นข้อความ '✅ บันทึกแล้ว!' เป็นอันพร้อมขายทันที"),

                new Paragraph({ spacing: { after: 150 } }),

                h2("การตรวจสอบสถานะระบบและเครดิตตรวจสลิป (แถบด้านบน)"),
                p("บนหน้าจอหลักจะมีแถบป้ายสถานะ (Pill Badge) คอยบอกความพร้อมของระบบ:"),
                bullet("🌐 LINE Webhook (สีเขียว)", "แสดงว่าระบบเชื่อมต่อกับ LINE Official Account ของร้านพร้อมแล้ว เมื่อลูกค้าส่งสลิป บอทจะได้รับข้อมูลทันที"),
                bullet("⚡ เครดิตตรวจสลิป (สีฟ้า/ส้ม)", "แสดงจำนวนสลิปที่เหลืออยู่ของระบบตรวจสลิป:"),
                new Paragraph({
                    indent: { left: 800 },
                    spacing: { before: 20, after: 40 },
                    children: [
                        new TextRun({ text: "• หากใช้ SlipOK: ", bold: true, font: "TH Sarabun New", size: 26, color: "1E293B" }),
                        new TextRun({ text: "ระบบจะแสดง เช่น 'SLIPOK: ใช้แล้ว 23/100 (เหลือ 77)' อย่างชัดเจนตามรอบบิล", font: "TH Sarabun New", size: 26, color: "334155" })
                    ]
                }),
                new Paragraph({
                    indent: { left: 800 },
                    spacing: { before: 20, after: 40 },
                    children: [
                        new TextRun({ text: "• หากใช้ EasySlip หรือ Thunder: ", bold: true, font: "TH Sarabun New", size: 26, color: "1E293B" }),
                        new TextRun({ text: "ระบบจะแสดงจำนวนเครดิตคงเหลือจริงในกระเป๋า เช่น 'คงเหลือ 150 ครั้ง'", font: "TH Sarabun New", size: 26, color: "334155" })
                    ]
                }),
                new Paragraph({
                    indent: { left: 800 },
                    spacing: { before: 20, after: 60 },
                    children: [
                        new TextRun({ text: "• กรณีเครดิตหมด: ", bold: true, font: "TH Sarabun New", size: 26, color: "DC2626" }),
                        new TextRun({ text: "ไม่ต้องตกใจ! ระบบจะเปิด 'โหมดสำรองตรวจมือฟรี' ให้อัตโนมัติทันที ออเดอร์ของลูกค้าจะไม่หลุดหายเด็ดขาด", font: "TH Sarabun New", size: 26, color: "334155" })
                    ]
                }),

                new Paragraph({ spacing: { after: 200 } }),

                // บทที่ 3
                h1("บทที่ 3: สรุปปุ่มกดและกระดานคิวทั้งหมดในระบบ (เข้าใจง่าย ไม่กดผิด)"),
                ...imgFigure("01_live_dashboard.png", "ภาพที่ 2: หน้าจอหลักขณะกำลังไลฟ์สด แสดงแถบควบคุม ตัวจับเวลา และกระดานคิวลูกค้า", 620, 400),

                h2("1. ปุ่มควบคุมหลักด้านบนสุด"),
                createTable(
                    ["ปุ่ม / สัญลักษณ์", "สี / รูปร่าง", "หน้าที่การทำงาน และผลลัพธ์"],
                    [
                        ["▶️ เริ่มไลฟ์สด", "ปุ่มสีเขียวสด", "กดเมื่อพร้อมเปิดกล้อง ระบบจะเช็กเครดิตให้ล่วงหน้า, เริ่มจับเวลา, และล็อกไม่ให้จอคอมดับตลอดการไลฟ์"],
                        ["⏱️ 00:00:00", "นาฬิกาสีดำ/เขียว", "แสดงระยะเวลาที่ไลฟ์สดอยู่จริง ช่วยให้แม่ค้าบริหารเวลาเปิดกล่องและสรุปยอดได้แม่นยำ"],
                        ["⏹️ จบไลฟ์สด", "ปุ่มสีแดง (แสดงเมื่อเริ่มไลฟ์)", "กดเมื่อไลฟ์สดเสร็จสิ้น ระบบจะหยุดเวลา และสรุปข้อมูลยอดขายทั้งหมดเข้าสู่ประวัติ"],
                        ["📦 Export Kerry Excel", "ปุ่มสีส้ม Kerry", "กดเพื่อดาวน์โหลดไฟล์รายชื่อลูกค้าและที่อยู่ สำหรับนำไปพิมพ์ใบปะหน้า Kerry Express"],
                        ["🔑 ตั้งค่าระบบ (Setup)", "ปุ่มสีเทาขวาบน", "กดเพื่อเข้าไปตรวจสอบประวัติการส่งสัญญาณ, เปลี่ยนรหัสผ่านร้านค้า หรือสลับแพ็กเกจ"]
                    ],
                    [2200, 2200, 4800]
                ),

                new Paragraph({ spacing: { after: 150 } }),

                h2("2. กระดานคิวทั้ง 4 กระดาน และปุ่มบนการ์ดลูกค้า"),
                p("กระดานคิวถูกแบ่งออกเป็น 4 กระดานชัดเจนตามแถบสีด้านซ้ายของการ์ด:"),
                createTable(
                    ["กระดานคิว / ปุ่มกด", "แถบสีประจำกระดาน", "การทำงาน และขั้นตอนที่แม่ค้าต้องปฏิบัติ"],
                    [
                        ["🎮 คิวที่กำลังเล่น (Active)", "แถบสีน้ำเงิน", "แสดงลูกค้าที่แม่ค้ากำลังพูดคุยหรือเล่นกิจกรรมหน้ากล้องขณะนี้ (มีได้ทีละ 1 คิว)"],
                        ["  • ปุ่ม '✅ เสร็จสิ้น'", "ปุ่มสีเขียวในการ์ด", "กดเมื่อสรุปของหรือเปิดกล่องให้ลูกค้ารายนี้เสร็จแล้ว คิวจะถูกบันทึกสำเร็จและนำออกจากจอ"],
                        ["  • ปุ่ม '⏭️ ข้าม'", "ปุ่มสีเหลืองในการ์ด", "กดเมื่อลูกค้าไม่อยู่หรือยังไม่ตอบ เพื่อส่งการ์ดไปพักไว้ในกระดาน Skipped ชั่วคราว"],
                        ["📋 คิวที่กำลังรอ (Waiting)", "แถบสีเขียว", "แสดงรายชื่อลูกค้าที่โอนเงินสำเร็จแล้ว กำลังต่อแถวรอเล่นกิจกรรม เรียงลำดับ #1, #2, #3..."],
                        ["  • ปุ่ม '📢 เรียกคิว'", "ปุ่มสีน้ำเงินในการ์ด", "กดเพื่อเรียกลูกค้าคนนี้ขึ้นมาเล่นกิจกรรม การ์ดจะย้ายขึ้นไปอยู่กระดาน Active ทันที"],
                        ["  • ปุ่ม '⏭️ ข้าม'", "ปุ่มสีเหลืองในการ์ด", "กดเพื่อข้ามคิวนี้ไปก่อน"],
                        ["  • ปุ่ม '❌ ยกเลิก'", "ปุ่มสีแดงขอบบาง", "กดเพื่อยกเลิกออเดอร์ของลูกค้ารายนี้ (ระบบจะหักยอดเงินและสิทธิ์คืนทันที)"],
                        ["  • ปุ่ม '🔍 เช็คสลิปและใส่ยอด'", "ปุ่มสีส้มในการ์ด", "จะปรากฏเมื่อลูกค้าส่งสลิปที่ไม่มี QR Code กดเพื่อเปิดดูรูปสลิปและพิมพ์ยอดเงิน"],
                        ["⏭️ คิวที่ถูกข้ามไป (Skipped)", "แถบสีแดง", "รวบรวมลูกค้าที่ถูกกดข้ามไว้ เพื่อไม่ให้เสียสิทธิ์การเล่น"],
                        ["  • ปุ่ม '📢 เรียกคิวอีกครั้ง'", "ปุ่มสีน้ำเงินในการ์ด", "เมื่อลูกค้ากลับมาดูไลฟ์ ให้กดปุ่มนี้เพื่อดึงคิวกลับขึ้นมาเล่นกิจกรรมได้ทันที"],
                        ["  • ปุ่ม '❌ ยกเลิกคิว'", "ปุ่มสีแดงขอบบาง", "กดยกเลิกคิวและคืนยอดออกหากลูกค้าขอสละสิทธิ์"],
                        ["📝 สลิปผิดปกติ (Abnormal)", "แถบสีส้ม", "แสดงสลิปที่ยอดเงินไม่ตรง หรือสลิปที่รอตรวจสอบความถูกต้องหลังจบไลฟ์"],
                        ["  • ปุ่ม '✅ ถูกต้อง (รวมยอด)'", "ปุ่มสีเขียวในการ์ด", "กดยืนยันเมื่อแม่ค้าเช็กแอปธนาคารแล้วพบว่าเงินเข้าจริง"],
                        ["  • ปุ่ม '❌ ไม่ถูกต้อง (ปัดตก)'", "ปุ่มสีแดงในการ์ด", "กดปัดตกเมื่อพบว่าเป็นสลิปปลอมหรือเงินไม่เข้าจริง"]
                    ],
                    [2500, 2000, 4700]
                ),

                new Paragraph({ spacing: { after: 150 } }),

                h2("3. หน้าต่างตรวจสอบภาพสลิปจริง (กรณีสลิปไม่มี QR Code)"),
                ...imgFigure("05_manual_slip_modal.png", "ภาพที่ 3: หน้าต่างตรวจสอบภาพสลิปจริง (สำหรับสลิปไม่มี QR Code หรือกรณีตรวจมือ)", 580, 360),
                p("หากลูกค้าใช้ธนาคารที่สลิปไม่มี QR Code หรือเซิร์ฟเวอร์ธนาคารขัดข้อง ระบบจะแสดงการ์ดสีส้มพร้อมปุ่ม '🔍 เช็คสลิปและใส่ยอด' ให้แม่ค้าทำตามนี้ครับ:"),
                bullet("1. ดูยอดเงินจากภาพขยาย", "ระบบจะเปิดรูปสลิปใบจริงขนาดใหญ่ขึ้นมาให้ดูยอดเงินและชื่อผู้รับ"),
                bullet("2. กรอกยอดเงิน", "พิมพ์ตัวเลขยอดเงินที่โอนจริงลงในช่อง 'กรอกยอดเงินที่โอนจริง' (เช่น 189 หรือ 378)"),
                bullet("3. กดยืนยันยอด", "กดปุ่มสีเขียว '✅ ยืนยันยอดเงิน' ระบบจะคำนวณจำนวนชิ้นและย้ายคิวเข้ากระดาน Waiting ให้ทันที"),
                bullet("กรณีลูกค้าส่งรูปอื่น", "หากลูกค้าส่งรูปสินค้า สติกเกอร์ หรือภาพที่ไม่ใช่สลิป ให้กดปุ่มสีแดง '❌ รูปนี้ไม่ใช่สลิป (ปัดตก)' เพื่อตัดทิ้งทันที"),

                new Paragraph({ spacing: { after: 200 } }),

                // บทที่ 4
                h1("บทที่ 4: ลำดับขั้นตอนปฏิบัติจริงระหว่างไลฟ์สด (Step-by-Step)"),
                p("ขั้นตอนการขายหน้ากล้องที่แม่ค้าต้องทำ มีเพียง 5 สเต็ปง่ายๆ ดังนี้ครับ:"),
                
                h2("สเต็ป 1: กดปุ่ม '▶️ เริ่มไลฟ์สด'"),
                p("เมื่อเปิดกล้องและเริ่มพูดทักทายลูกค้า ให้คลิกปุ่มสีเขียว '▶️ เริ่มไลฟ์สด':"),
                bullet("ระบบตรวจสอบความปลอดภัย", "ระบบจะเช็กเครดิตตรวจสลิปให้ทันที หากเครดิตเหลือพอ ระบบจะเริ่มจับเวลาทันที หากเครดิตหมดจะมีป๊อปอัปแจ้งเตือนและสลับไปโหมดตรวจมือฟรีให้อัตโนมัติ"),
                bullet("ล็อกหน้าจอคอมพิวเตอร์", "ระบบ Sleep Blocker จะเริ่มทำงานอัตโนมัติ ล็อกไม่ให้หน้าจอคอมดับหรือเข้าโหมด Sleep ตลอดระยะเวลาไลฟ์"),

                h2("สเต็ป 2: ลูกค้าโอนเงินและส่งสลิปเข้า LINE Official Account"),
                bullet("ระบบตรวจสลิปอัตโนมัติ 1-3 วินาที", "เมื่อลูกค้ากดส่งรูปสลิปในห้องแชท LINE ระบบจะตรวจสอบรหัสธุรกรรม ยอดเงิน และชื่อบัญชีร้านค้าทันที"),
                bullet("เสียงแจ้งเตือนและคิวเด้งขึ้นกระดาน", "เมื่อสลิปผ่าน จะมีเสียงกระดิ่งเตือนดังขึ้นในคอมพิวเตอร์ และการ์ดคิวของลูกค้าจะเด้งเข้าไปอยู่ในกระดาน '📋 คิวที่กำลังรอ (Waiting)' เรียงตามลำดับเวลาโอนเงินอย่างแม่นยำ"),

                h2("สเต็ป 3: ลูกค้าโอนเงินเพิ่มระหว่างรอคิว (Smart Merge)"),
                p("หากลูกค้าคนที่รอคิวอยู่ โอนเงินเพิ่มเข้ามาอีกรอบ (เช่น รอบแรกโอน 1 กล่อง แล้วอยากโอนเพิ่มอีก 2 กล่อง):"),
                callout("💡 ระบบทบยอดให้อัตโนมัติ (ไม่เสียลำดับคิวเดิม)",
                    "ระบบของ AutoQueue for Live จะตรวจจับบัญชี LINE เดิม แล้วนำยอดเงินและจำนวนกล่องไป 'ทบเข้ากับการ์ดคิวเดิมทันที' โดยที่ลำดับคิวเดิมจะไม่ตกหล่น และไม่แตกเป็นการ์ดใหม่ซ้ำซ้อน แม่ค้าจึงเปิดของให้ลูกค้าได้ครบตามจำนวนโดยไม่งง!",
                    "info"
                ),

                h2("สเต็ป 4: เรียกลูกค้าขึ้นมาเล่นกิจกรรม (📢 เรียกคิว)"),
                p("เมื่อแม่ค้าพร้อมเปิดกล่องหรือเล่นกิจกรรมกับคิวถัดไป ให้กดปุ่มสีน้ำเงิน '📢 เรียกคิว' ที่การ์ดลูกค้าคนแรก การ์ดจะวิ่งขึ้นไปอยู่ในกระดานสีน้ำเงิน '🎮 คิวที่กำลังเล่นกิจกรรม (Active)' ทันที"),

                h2("สเต็ป 5: เมื่อเล่นกิจกรรมเสร็จสิ้น (✅ เสร็จสิ้น)"),
                p("เมื่อเปิดกล่องหรือสรุปสินค้าให้ลูกค้ารายนี้เสร็จเรียบร้อย ให้กดปุ่มสีเขียว '✅ เสร็จสิ้น' การ์ดจะถูกบันทึกสำเร็จและนำออกจากหน้าจออย่างสวยงาม และสามารถกดเรียกคิวถัดไปได้ทันที"),

                new Paragraph({ spacing: { after: 200 } }),

                // บทที่ 5
                h1("บทที่ 5: ขั้นตอนหลังจบไลฟ์สด & สั่งพิมพ์ใบปะหน้า Kerry Express"),
                ...imgFigure("04_kerry_export_modal.png", "ภาพที่ 4: หน้าต่างสรุปข้อมูลพัสดุ Kerry Express พร้อมดาวน์โหลดไฟล์ Excel", 580, 360),
                p("เมื่อปิดกล้องไลฟ์สดเรียบร้อยแล้ว ให้ทำตามขั้นตอนการสรุปยอดและส่งของดังนี้ครับ:"),

                h2("สเต็ป 5.1: กดปุ่มสีแดง '⏹️ จบไลฟ์สด'"),
                p("กดปุ่ม '⏹️ จบไลฟ์สด' ระบบจะหยุดเวลา และสรุปข้อมูลออเดอร์ทั้งหมดของไลฟ์รอบนี้เข้าสู่ฐานข้อมูลประวัติ"),

                h2("สเต็ป 5.2: ตรวจสอบกระดานสลิปผิดปกติ (ถ้ามี)"),
                p("หากมีสลิปอยู่ในกระดานสีส้ม ให้เปิดแอปธนาคารตรวจเช็กดูยอดเงิน:"),
                bullet("หากเงินเข้าจริง", "กดปุ่ม '✅ ถูกต้อง (รวมยอด)' ระบบจะรวมยอดและปิดงานให้"),
                bullet("หากเงินไม่เข้าจริง", "กดปุ่ม '❌ ไม่ถูกต้อง (ปัดตก)' เพื่อตัดยอดทิ้ง"),

                h2("สเต็ป 5.3: ดาวน์โหลดไฟล์ Excel สำหรับ Kerry Express"),
                bullet("1. กดปุ่มสีส้ม", "กดปุ่ม '📦 Export Kerry Excel' ที่มุมบนขวา"),
                bullet("2. ตรวจสอบที่อยู่ลูกค้า", "ระบบ Gemini AI อัจฉริยะจะดึงชื่อ ที่อยู่ เบอร์โทร จากแชท LINE ของลูกค้ามาจัดรูปแบบให้อัตโนมัติ (หากมีลูกค้าคนไหนยังไม่ได้พิมพ์ที่อยู่ จะมีชื่อแสดงในกล่องสีแดงเพื่อให้แอดมินทักตาม)"),
                bullet("3. ดาวน์โหลดไฟล์", "กดปุ่ม '📥 ดาวน์โหลดไฟล์ Excel (Kerry)' จะได้ไฟล์ Excel บันทึกลงในเครื่องคอมพิวเตอร์ของคุณ"),

                h2("สเต็ป 5.4: นำเข้าเว็บ Kerry EasyShip (พิมพ์ใบปะหน้าใน 1 คลิก)"),
                bullet("1. เข้าสู่ระบบ Kerry", "เปิดเว็บ Kerry Express EasyShip (https://easyship.kerryexpress.com)"),
                bullet("2. เลือกเมนูนำเข้า", "ไปที่เมนู 'สร้างรายการพัสดุ' -> เลือก 'สร้างพัสดุหลายรายการ (Bulk Upload / นำเข้าไฟล์ Excel)'"),
                bullet("3. อัปโหลดไฟล์", "เลือกไฟล์ Excel ที่ดาวน์โหลดมาจากระบบของเรา"),
                bullet("4. พิมพ์ใบปะหน้า", "ข้อมูลชื่อ ที่อยู่ เบอร์โทร รหัสไปรษณีย์ของลูกค้าทุกคนจะถูกจัดลงช่องอย่างสมบูรณ์แบบ 100% สั่งพิมพ์ใบปะหน้าติดกล่องได้ทันที ไม่ต้องพิมพ์ที่อยู่เองแม้แต่คนเดียว!"),

                new Paragraph({ spacing: { after: 200 } }),

                // บทที่ 6
                h1("บทที่ 6: คำถามที่พบบ่อยสำหรับแม่ค้ามือใหม่ (FAQ & เคล็ดลับ)"),
                
                h2("Q1: ถ้าเน็ตสะดุด หรือเผลอปิดโปรแกรม ข้อมูลคิวและยอดเงินจะหายไหม?"),
                p("👉 ไม่หายแน่นอนครับ! ข้อมูลทั้งหมดถูกบันทึกลงฐานข้อมูลในเครื่องคอมพิวเตอร์ของคุณแบบเรียลไทม์ทันที เมื่อเปิดโปรแกรมขึ้นมาใหม่ ทุกคิวและยอดเงินจะกลับมาอยู่ที่เดิม 100%"),

                h2("Q2: หน้าจอคอมพิวเตอร์จะดับหรือเข้า Sleep Mode ระหว่างไลฟ์ไหม?"),
                p("👉 ไม่ดับครับ! ทันทีที่กดปุ่ม '▶️ เริ่มไลฟ์สด' ระบบมีระบบป้องกัน Windows Sleep Mode ทำงานอยู่เบื้องหลัง หน้าจอจะสว่างและพร้อมใช้งานตลอดการไลฟ์"),

                h2("Q3: ลูกค้าโอนเงินเข้ามาซ้ำกัน คิวจะเด้งซ้ำไหม?"),
                p("👉 ระบบมีระบบ Smart Deduplication ป้องกันสลิปซ้ำ หากลูกค้าส่งรูปสลิปใบเดิมซ้ำเข้ามา ระบบจะไม่รับสลิปซ้ำ แต่หากลูกค้าโอนเงินยอดใหม่จริง ระบบจะทบยอดและจำนวนกล่องเข้าการ์ดคิวเดิมให้อัตโนมัติ"),

                h2("Q4: ถ้าเครดิตตรวจสลิปหมดกลางคัน ต้องทำอย่างไร?"),
                p("👉 ไม่ต้องกังวลและไม่ต้องหยุดไลฟ์ครับ! เมื่อเครดิตหมด ระบบจะสลับไปที่ 'โหมดสำรองตรวจมือฟรี' ให้อัตโนมัติ โดยสลิปของลูกค้าจะเด้งขึ้นมาพร้อมปุ่มสีส้มให้แม่ค้าดูยอดและกดยืนยันด้วยตนเองได้ทันที ออเดอร์ไม่สะดุดแน่นอนครับ"),

                h2("Q5: สามารถเปลี่ยนขนาดแพ็กเกจ SlipOK ได้ที่ไหน?"),
                p("👉 กดที่ปุ่ม '🔑 ตั้งค่าระบบ (Setup)' ที่มุมขวาบน จะมีตัวเลือกแพ็กเกจ SlipOK (100 / 500 / 1500 / 5000 สลิป) ให้เลือกปรับให้ตรงกับบัญชีจริงของคุณได้ตลอดเวลาครับ"),

                new Paragraph({ spacing: { after: 300 } }),

                // Footer Box
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

async function run() {
    console.log("📄 Generating User Manual (Operator Edition)...");
    const doc = buildOperatorManualDoc();
    const buffer = await Packer.toBuffer(doc);
    
    // Save to Project Directory
    const projectPath = path.join(__dirname, "User_Manual_Operator_Edition.docx");
    fs.writeFileSync(projectPath, buffer);
    console.log("✅ Saved to project directory:", projectPath);

    // Save directly to User Desktop for convenience
    const desktopPath = "C:\\Users\\napat\\OneDrive\\Desktop\\User_Manual_Operator_Edition.docx";
    try {
        fs.writeFileSync(desktopPath, buffer);
        console.log("✅ Saved directly to User Desktop:", desktopPath);
    } catch(e) {
        console.warn("Could not save to desktop:", e.message);
    }

    // Also write to Artifact Directory if exists
    const artifactPath = "C:\\Users\\napat\\.gemini\\antigravity\\brain\\82c1fccc-253f-4df2-a685-20e6068f9a40\\User_Manual_Operator_Edition.docx";
    try {
        fs.writeFileSync(artifactPath, buffer);
        console.log("✅ Saved to artifact directory:", artifactPath);
    } catch(e) {}
}

run();
