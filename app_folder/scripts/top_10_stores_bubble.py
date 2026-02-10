import os
import pandas as pd
import plotly.express as px

# Get absolute paths (works from any directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Read input file
df = pd.read_csv(os.path.join(INPUT_FOLDER, "sales.csv"))
df["Weekly_Sales"] = pd.to_numeric(df["Weekly_Sales"], errors="coerce")

# Aggregate per store: total sales and number of unique departments (proxy for size)
store_stats = df.groupby("Store").agg(
    Total_Sales=("Weekly_Sales", "sum"),
    Num_Departments=("Dept", "nunique")
).reset_index()

# Top 10 stores by total sales
top10 = store_stats.nlargest(10, "Total_Sales")
top10["Store_Label"] = "Store " + top10["Store"].astype(str)

# Save underlying data as CSV
top10.to_csv(os.path.join(OUTPUT_FOLDER, "top_10_stores_bubble.csv"), index=False)

# Create bubble chart with Plotly
fig = px.scatter(
    top10,
    x="Total_Sales",
    y="Num_Departments",
    size="Total_Sales",
    color="Store_Label",
    text="Store_Label",
    title="Top 10 Stores — Bubble Chart (Bubble size = Total Sales)",
    labels={
        "Total_Sales": "Total Sales ($)",
        "Num_Departments": "Number of Departments (Store Size)",
        "Store_Label": "Store"
    },
    size_max=60
)

fig.update_traces(textposition="middle center")
fig.update_layout(
    width=1000,
    height=700,
    xaxis_tickformat="$,.0f",
    font=dict(size=12),
    title_font=dict(size=16)
)

fig.write_image(os.path.join(OUTPUT_FOLDER, "top_10_stores_bubble.png"), scale=2)
fig.write_html(os.path.join(OUTPUT_FOLDER, "top_10_stores_bubble.html"))

print(f"Saved chart (PNG) to {os.path.join(OUTPUT_FOLDER, 'top_10_stores_bubble.png')}")
print(f"Saved chart (HTML) to {os.path.join(OUTPUT_FOLDER, 'top_10_stores_bubble.html')}")
print(f"Saved data to {os.path.join(OUTPUT_FOLDER, 'top_10_stores_bubble.csv')}")
