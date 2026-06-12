curl --location 'http://localhost:4000/v1/chat/completions' \
--header 'Authorization: Bearer sk-master-key-change-me' \
--header 'Content-Type: application/json' \
--data '{
    "model": "system-utility",
    "messages": [
        {
            "role": "user",
            "content": "用python写一个简单的helloworld demo"
        }
    ],
    "user": "zhangsan"
}'