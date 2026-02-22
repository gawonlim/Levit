"""
cleaned_data.csv에서 image_url과 data/image_data 폴더의 사진을 비교해,
image_data에 해당 이미지가 있는 행만 남기고 final_data.csv로 저장합니다.
URL과 로컬 파일명의 '마지막 string 부분'(예: pe951817_s5.jpg)으로 매칭합니다.
"""

import os
import re
import pandas as pd

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(DATA_DIR, "cleaned_data.csv")
IMAGE_DIR = os.path.join(DATA_DIR, "image_data")
OUT_PATH = os.path.join(DATA_DIR, "final_data.csv")

# URL/파일명에서 이미지 식별자 추출: pe숫자_s5.jpg
PE_PATTERN = re.compile(r"pe\d+_s5\.jpg", re.IGNORECASE)


def get_available_image_keys():
    """image_data 폴더 내 파일명에서 pe*_s5.jpg 패턴을 추출해 set으로 반환."""
    if not os.path.isdir(IMAGE_DIR):
        return set()
    keys = set()
    for name in os.listdir(IMAGE_DIR):
        for m in PE_PATTERN.findall(name):
            keys.add(m.lower())
    return keys


def extract_pe_keys_from_url(url_str):
    """하나의 image_url 필드(쉼표로 여러 URL 가능)에서 pe*_s5.jpg 목록 반환."""
    if pd.isna(url_str) or not str(url_str).strip():
        return set()
    keys = set()
    for part in str(url_str).split(","):
        part = part.strip()
        # ? 이전까지만 (쿼리 제거)
        if "?" in part:
            part = part.split("?")[0]
        for m in PE_PATTERN.findall(part):
            keys.add(m.lower())
    return keys


def main():
    available = get_available_image_keys()
    print(f"image_data에서 추출한 이미지 키 개수: {len(available)}")

    df = pd.read_csv(CSV_PATH)
    print(f"cleaned_data.csv 행 수: {len(df)}")

    keep_mask = []
    for idx, row in df.iterrows():
        url_val = row.get("image_url")
        row_keys = extract_pe_keys_from_url(url_val)
        has_match = bool(row_keys and (row_keys & available))
        keep_mask.append(has_match)

    df_filtered = df.loc[keep_mask].copy()
    removed = len(df) - len(df_filtered)
    print(f"유지할 행 수: {len(df_filtered)}, 제거할 행 수: {removed}")

    df_filtered.to_csv(OUT_PATH, index=False, encoding="utf-8-sig")
    print(f"저장 완료: {OUT_PATH}")


if __name__ == "__main__":
    main()
