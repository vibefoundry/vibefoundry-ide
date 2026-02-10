import os
import pandas as pd
import matplotlib.pyplot as plt

# Get absolute paths (works from any directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Read data
df = pd.read_csv(os.path.join(INPUT_FOLDER, "sales.csv"))
df["Weekly_Sales"] = pd.to_numeric(df["Weekly_Sales"], errors="coerce")
df["Date"] = pd.to_datetime(df["Date"], format="mixed")

# Find the latest month
df["YearMonth"] = df["Date"].dt.to_period("M")
latest_month = df["YearMonth"].max()

# Filter to the latest month
latest_df = df[df["YearMonth"] == latest_month]

# Top 5 stores by total sales in the latest month
top5 = (
    latest_df.groupby("Store")["Weekly_Sales"]
    .sum()
    .sort_values(ascending=False)
    .head(5)
    .reset_index()
)
top5["Store"] = top5["Store"].astype(str)

# Save underlying data as CSV
top5.to_csv(os.path.join(OUTPUT_FOLDER, "top_5_stores_latest_month.csv"), index=False)

# Create bar chart
fig, ax = plt.subplots(figsize=(12, 8))
bars = ax.bar(top5["Store"], top5["Weekly_Sales"], color="yellow", edgecolor="white")

# Add value labels on bars
for bar in bars:
    height = bar.get_height()
    ax.text(
        bar.get_x() + bar.get_width() / 2.0,
        height,
        f"${height:,.0f}",
        ha="center",
        va="bottom",
        fontsize=11,
        fontweight="bold",
    )

ax.set_title(f"Top 5 Stores by Sales — {latest_month}", fontsize=14, fontweight="bold", pad=20)
ax.set_xlabel("Store", fontsize=12)
ax.set_ylabel("Total Sales ($)", fontsize=12)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"${x:,.0f}"))

plt.tight_layout()
plt.savefig(
    os.path.join(OUTPUT_FOLDER, "top_5_stores_latest_month.png"),
    dpi=150,
    bbox_inches="tight",
    pad_inches=0.3,
    facecolor="white",
)
plt.close()

print(f"Latest month in data: {latest_month}")
print(f"Saved chart to {os.path.join(OUTPUT_FOLDER, 'top_5_stores_latest_month.png')}")
print(f"Saved data to {os.path.join(OUTPUT_FOLDER, 'top_5_stores_latest_month.csv')}")
