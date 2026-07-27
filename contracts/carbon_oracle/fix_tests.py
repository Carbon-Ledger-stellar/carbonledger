import re

with open('src/lib.rs', 'r') as f:
    content = f.read()

# Define dummy key and sig variables for tests
dummy_key = "let dummy_pub = BytesN::from_array(&env, &[0; 32]);\n        "
dummy_sig = "let dummy_sig = BytesN::from_array(&env, &[0; 64]);\n        let dummy_nonce = 0_u64;"

# Replace initialize calls
content = re.sub(
    r'client\.initialize\((.*?),\n*\s*(.*?)\)',
    r'let dummy_pub = BytesN::from_array(env, &[0; 32]);\n        client.initialize(\1, \2, &dummy_pub)',
    content
)
content = re.sub(
    r'client\.try_initialize\((.*?),\s*(.*?)\)',
    r'client.try_initialize(\1, \2, &BytesN::from_array(&env, &[0; 32]))',
    content
)

# Replace rotate_oracle calls
content = re.sub(
    r'client\.rotate_oracle\((.*?),\s*(.*?)\)',
    r'client.rotate_oracle(\1, \2, &BytesN::from_array(&env, &[0; 32]))',
    content
)
content = re.sub(
    r'client\.try_rotate_oracle\((.*?),\s*(.*?)\)',
    r'client.try_rotate_oracle(\1, \2, &BytesN::from_array(&env, &[0; 32]))',
    content
)

# Replace submit_monitoring_data calls
content = re.sub(
    r'(client\.submit_monitoring_data\([^;]+?)(,\n\s*&s\(&env, "[^"]+"\)\n\s*\);)',
    r'\1\2[:-2] + ",\n            &BytesN::from_array(&env, &[0; 64]),\n            &0_u64\n        );"',
    content
)

content = re.sub(
    r'(client\.try_submit_monitoring_data\([^;]+?)(,\n\s*&s\(&env, "[^"]+"\)\n\s*\);)',
    r'\1\2[:-2] + ",\n            &BytesN::from_array(&env, &[0; 64]),\n            &0_u64\n        );"',
    content
)

with open('src/lib.rs', 'w') as f:
    f.write(content)
