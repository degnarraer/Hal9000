<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('firstName','lastName','email','username','password','password-confirm') displayInfo=false; section>
  <#if section = "header">
    <div class="bighal-brand">
      <img class="bighal-mark" src="${url.resourcesPath}/img/big_hal.png" alt="Big Hal">
      <h1>Big Hal</h1>
      <p>Your Personal Assistant</p>
    </div>
  <#elseif section = "form">
    <form id="kc-register-form" class="bighal-form" action="${url.registrationAction}" method="post">
      <#if !realm.registrationEmailAsUsername>
        <label for="username">${msg("username")}</label>
        <input id="username" name="username" value="${(register.formData.username!'')}" type="text" autocomplete="username">
      </#if>

      <label for="email">${msg("email")}</label>
      <input id="email" name="email" value="${(register.formData.email!'')}" type="email" autocomplete="email">

      <#if passwordRequired??>
        <label for="password">${msg("password")}</label>
        <input id="password" name="password" type="password" autocomplete="new-password">

        <label for="password-confirm">${msg("passwordConfirm")}</label>
        <input id="password-confirm" name="password-confirm" type="password" autocomplete="new-password">
      </#if>

      <button class="bighal-primary" type="submit">${msg("doRegister")}</button>
      <div class="bighal-register">
        <a href="${url.loginUrl}">${msg("backToLogin")}</a>
      </div>
    </form>
  </#if>
</@layout.registrationLayout>
