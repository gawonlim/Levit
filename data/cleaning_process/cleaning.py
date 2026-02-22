import pandas as pd
import re

# =========================
# 1. Load raw scraped data
# =========================
df = pd.read_csv("data.csv")

# =========================
# 2. Seats Recommended (의자4 → 4)
# =========================
def extract_seats(name):
    match = re.search(r'의자\s*(\d+)', str(name))
    if match:
        return int(match.group(1))
    return None

df["seats_recommended"] = df["제품명"].apply(extract_seats)

# =========================
# 3. Fixed Columns
# =========================
df["category"] = "dining_table_set"
df["brand"] = "IKEA"

# =========================
# 4. Color Extraction
# =========================
def extract_color(text):
    text = str(text)

    if "화이트" in text or "white" in text.lower():
        return "white"
    if "블랙" in text or "black" in text.lower():
        return "black"
    if "라이트" in text or "밝은" in text:
        return "light_wood"
    if "다크" in text or "앤티크" in text:
        return "dark_wood"
    if "소나무" in text or "물푸레" in text or "오크" in text:
        return "wood"
    
    return "unknown"

df["color_main"] = df["제품명"].apply(extract_color)

# =========================
# 5. Style Tags (MVP 기본값)
# =========================
df["style_tags"] = "modern,nordic,minimal"

# =========================
# 6. Child Safety Tag
# =========================
def detect_child_safe(text):
    text = str(text)
    keywords = ["가정용", "EN 12520", "안전", "규정 준수"]
    return any(keyword in text for keyword in keywords)

df["is_child_safe"] = df["안전 및 규정 준수"].apply(detect_child_safe)

# =========================
# 7. Maintenance Level
# =========================
def detect_maintenance(text):
    text = str(text)

    if "물로 닦" in text or "중성세제" in text:
        return "low"
    if "정기적 관리" in text or "오일" in text:
        return "medium"
    
    return "medium"  # 기본값

df["maintenance_level"] = df["제품 관리"].apply(detect_maintenance)

# =========================
# 8. Assembly Required
# =========================
def detect_assembly(text):
    text = str(text)
    return "조립" in text

df["has_assembly_required"] = df["제품 설명"].apply(detect_assembly)

# =========================
# 9. index_text 생성 (FAISS용)
# =========================
df["index_text"] = (
    df["제품명"].fillna("") + " " +
    df["제품 설명"].fillna("") + " " +
    df["소재"].fillna("") + " " +
    df["제품 관리"].fillna("") + " " +
    df["고객 리뷰"].fillna("")
)

# =========================
# 10. Rename Columns (영문화)
# =========================
df_cleaned = df.rename(columns={
    "제품명": "product_name",
    "제품 URL": "product_url",
    "제품 이미지": "image_url",
    "가격 (KRW)": "price_krw",
    "정가 (KRW)": "original_price_krw",
    "고객 평가 (5점 만점)": "rating",
    "총 리뷰 수": "review_count",
    "제품 번호": "product_id",
    "제품 설명": "description",
    "소재": "material",
    "제품 관리": "care_info",
    "안전 및 규정 준수": "safety_info",
    "테이블 가로 (cm)": "table_width_cm",
    "테이블 세로 (cm)": "table_length_cm",
    "탁자 높이 (cm)": "table_height_cm",
    "의자 가로 (cm)": "chair_width_cm",
    "의자 세로 (cm)": "chair_depth_cm",
    "의자 높이 (cm)": "chair_height_cm",
    "포장 정보": "package_info",
    "고객 리뷰": "review_text"
})

# =========================
# 11. Save cleaned CSV
# =========================
df_cleaned.to_csv("cleaned_data.csv", index=False)

print("cleaned_data.csv 생성 완료 🚀")