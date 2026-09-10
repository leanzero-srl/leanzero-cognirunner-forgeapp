# CogniRunner - Copyright (C) 2025 LeanZero; SPDX-License-Identifier: AGPL-3.0-or-later
"""Build deterministic one-page evidence PDFs from the authored campaign catalog."""
import json, pathlib, sys, html
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader

source, output = map(pathlib.Path, sys.argv[1:3])
catalog = json.loads(source.read_text())
output.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='EvidenceTitle', fontName='Helvetica-Bold', fontSize=19, leading=23, textColor=HexColor('#0f172a'), spaceAfter=10))
styles.add(ParagraphStyle(name='EvidenceBody', fontName='Helvetica', fontSize=9, leading=12, spaceAfter=8))
styles.add(ParagraphStyle(name='EvidenceMeta', fontName='Helvetica-Bold', fontSize=9, leading=12, textColor=HexColor('#2563eb'), spaceAfter=12))

class StableCanvas(Canvas):
    def __init__(self, *args, **kwargs):
        kwargs['invariant'] = 1
        super().__init__(*args, **kwargs)

def footer(canvas, doc):
    canvas.setFillColor(HexColor('#475569'))
    canvas.setFont('Helvetica', 8)
    canvas.drawString(42, 28, 'LeanZero Apps Demo | Prepared synthetic evidence | Actual approval pending')
    canvas.drawRightString(553, 28, str(doc.page))

count = 0
for space in catalog['spaces']:
    for page in space['pages']:
        for attachment in page['attachments']:
            if attachment['format'] != 'pdf':
                continue
            target = output / attachment['name']
            story = [Paragraph(html.escape(page['title']), styles['EvidenceTitle']), Paragraph(html.escape(page['project']+' / '+page['identity']+' / '+page['owner']), styles['EvidenceMeta'])]
            headings = ['Purpose and scope', 'Observed sample', 'Proposed response', 'Acceptance checks', 'Rework procedure', 'Evidence provenance']
            for title, paragraph in zip(headings, page['paragraphs']):
                story.append(Paragraph('<b>'+title+'</b>', styles['EvidenceBody']))
                story.append(Paragraph(html.escape(paragraph), styles['EvidenceBody']))
            rows = [['Cohort', 'Sample', 'Pass', 'Exception']]+[[r['cohort'], r['sample'], r['passed'], r['exceptions']] for r in page['measurements'][:3]]
            table = Table(rows, colWidths=[180,100,100,131], hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#2563eb')),('TEXTCOLOR',(0,0),(-1,0),white),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('GRID',(0,0),(-1,-1),0.4,HexColor('#94a3b8'))]))
            story.extend([Spacer(1,8),table])
            SimpleDocTemplate(str(target),pagesize=(595,842),leftMargin=42,rightMargin=42,topMargin=36,bottomMargin=46,title=page['title'],author='LeanZero Demo').build(story,onFirstPage=footer,onLaterPages=footer,canvasmaker=StableCanvas)
            pdf=PdfReader(target)
            assert len(pdf.pages)==1, (target,'Unexpected pagination')
            extracted=pdf.pages[0].extract_text()
            for text in [page['identity'], page['project'], 'Acceptance checks', 'Evidence provenance']:
                assert text in extracted, (target,text)
            count+=1
assert count==48, count
print(json.dumps({'pdfs':count,'singlePage':True,'requiredTextVerified':True}))
