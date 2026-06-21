<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !(registrationDisabled??); section>
  <#if section = "header">
    <div class="bighal-brand">
      <img class="bighal-mark" src="${url.resourcesPath}/img/big_hal.png" alt="Big Hal">
      <h1>Big Hal</h1>
      <p>Your Personal Assistant</p>
    </div>
  <#elseif section = "form">
    <form id="kc-form-login" class="bighal-form" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
      <#if !(usernameHidden??)>
        <label for="username"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
        <input tabindex="1" id="username" name="username" value="${(login.username!'')}" type="text" autocomplete="username" autofocus>
      </#if>

      <label for="password">${msg("password")}</label>
      <input tabindex="2" id="password" name="password" type="password" autocomplete="current-password">

      <div class="bighal-options">
        <#if realm.rememberMe && !(usernameHidden??)>
          <label class="bighal-check" for="rememberMe">
            <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox" <#if login.rememberMe??>checked</#if>>
            <span>${msg("rememberMe")}</span>
          </label>
        </#if>
        <#if realm.resetPasswordAllowed>
          <a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
        </#if>
      </div>

      <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>>
      <button tabindex="4" class="bighal-primary" name="login" id="kc-login" type="submit">${msg("doLogIn")}</button>
    </form>
  <#elseif section = "info">
    <#if realm.password && realm.registrationAllowed && !(registrationDisabled??)>
      <div class="bighal-register">
        <a href="${url.registrationUrl}">${msg("doRegister")}</a>
      </div>
    </#if>
  </#if>
</@layout.registrationLayout>
