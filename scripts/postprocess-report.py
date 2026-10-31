#!/usr/bin/env python3
"""Post-process the validation report docx (WPS compatibility, toc.md rules):
1. Remove empty <w:pgNumType/> from sections without pageNumbers (cover/TOC).
2. Patch footer instrText: bare PAGE -> PAGE \\* arabic \\* MERGEFORMAT.
"""
import re, shutil, sys, zipfile, os

path = sys.argv[1]
tmp = path + '.tmp'

zin = zipfile.ZipFile(path, 'r')
zout = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == 'word/document.xml':
        xml = data.decode('utf-8')
        xml = xml.replace('<w:pgNumType/>', '')
        data = xml.encode('utf-8')
    elif re.match(r'word/footer\d+\.xml', item.filename):
        xml = data.decode('utf-8')
        xml = re.sub(r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
                     r'\1 PAGE \\* arabic \\* MERGEFORMAT \2', xml)
        data = xml.encode('utf-8')
    zout.writestr(item, data)
zin.close()
zout.close()
shutil.move(tmp, path)
print('postprocess OK:', os.path.basename(path))
