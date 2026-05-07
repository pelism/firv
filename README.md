![firv-logo.png](src/assets/icons/firv-logo.png)

# firv
An app for making HTTP requests and viewing responses.


# Script example
```js
const response = firv.sendRequest({
    url: "https://example.com/api/login",
    method: "POST",
    headers: {
        "Content-Type": "application/x-www-form-urlencoded"
    },
    body: firv.encodeForm({
        username: "dev_user",
        password: "dev_password"
    })
});
```
