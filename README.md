# CDC 衛福部防疫中心 IFC 模型檢視

線上檢視：https://wsl0407.github.io/CDCBIMMODEL/

以瀏覽器檢視 CDC 案聯合 IFC 模型（Revit 匯出 IFC2X3，16 個檔，共用 TWD97 座標）：子模型分批載入、樓層／類別／構件樹／搜尋／統計、剖切盒、量測、X 光、軸線、屬性集。

## 結構
- `index.html`、`app.js`：檢視器（three.js）
- `data/manifest.json`：子模型清單與專案資訊
- `data/<子模型>/geo.wasm`：幾何（gzip；實例化 + int16 量化）
- `data/<子模型>/meta.wasm`：構件清單（gzip JSON）
- `data/<子模型>/props.wasm`：屬性集（gzip JSON，選取時才載入）

> 副檔名 `.wasm` 只是為了讓託管平台接受二進位檔，內容並非 WebAssembly。

## 重新轉換
需要 Python 與 `ifcopenshell`：
```
python3 tools/convert.py <檔案.ifc> out/<ID> <ID>   # 每個 IFC 一次（見 tools/runall.sh）
python3 tools/build_site.py                          # 組裝 site/data 與 manifest
```
未納入：「整合MEP-SD（機電疑義管制總表）整合」469 MB（與六個機電分項檔重複）。
